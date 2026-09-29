import sys

with open(r'C:\Users\epicn\Documents\sites\Stickitout\analyzer\app\fusion.py', 'r', encoding='utf-8') as f:
    content = f.read()

new_functions = '''
def compute_av_offset(audio: dict, tracks: Tracks, search_ms: float = 200.0) -> float:
    """Estimate the audio-to-video time offset by cross-correlating audio onset
    impulses with wrist downward motion energy. Returns offset in milliseconds:
    positive means video lags audio (add to video times to align).
    """
    from scipy.signal import correlate
    onset_times = np.array([o["t"] for o in audio["onsets"]])
    if len(onset_times) < 4 or len(tracks.t) < 10:
        return 0.0
    # Build signals at 1000 Hz
    t_min = min(onset_times[0], tracks.t[0]) - 0.1
    t_max = max(onset_times[-1], tracks.t[-1]) + 0.1
    rate = 1000.0
    t_common = np.arange(t_min, t_max, 1.0 / rate)
    # Audio: Gaussian-smoothed impulses at onset times (sigma = 5 ms)
    a_signal = np.zeros_like(t_common)
    sigma = 0.005
    for ot in onset_times:
        a_signal += np.exp(-0.5 * ((t_common - ot) / sigma) ** 2)
    # Video: combined downward wrist velocity (positive = downward)
    vel_l = np.interp(t_common, tracks.t, tracks.velocity("lw"))
    vel_r = np.interp(t_common, tracks.t, tracks.velocity("rw"))
    v_signal = np.maximum(vel_l, 0.0) + np.maximum(vel_r, 0.0)
    # Normalize both
    a_signal = (a_signal - a_signal.mean())
    v_signal = (v_signal - v_signal.mean())
    a_norm = np.sqrt(np.sum(a_signal ** 2))
    v_norm = np.sqrt(np.sum(v_signal ** 2))
    if a_norm < 1e-9 or v_norm < 1e-9:
        return 0.0
    a_signal /= a_norm
    v_signal /= v_norm
    # Cross-correlate
    corr = correlate(a_signal, v_signal, mode="full")
    lags = np.arange(-len(v_signal) + 1, len(a_signal)) / rate
    # Restrict to search range
    search_s = search_ms / 1000.0
    mask = np.abs(lags) <= search_s
    if not mask.any():
        return 0.0
    corr_masked = corr[mask]
    lags_masked = lags[mask]
    best_lag = lags_masked[np.argmax(corr_masked)]
    return round(float(best_lag) * 1000.0, 2)


def _score_hand_at(motion: _Motion, t: float, hand: str, tune) -> float:
    """Score how likely `hand` played the onset at time `t` based on wrist kinematics.
    Higher score = more likely this hand struck. Considers:
    - elevation (is the wrist low, near the pad?)
    - recent downward velocity (did the wrist move down recently?)
    - deceleration impulse (did the wrist stop/reverse, indicating impact?)
    """
    lookback = tune.hand_score_lookback_ms / 1000.0
    key_map = {"L": "lw", "R": "rw"}
    # Find frames in the lookback window [t - lookback, t + 10ms]
    idx = np.where((motion.t >= t - lookback) & (motion.t <= t + 0.01))[0]
    if not len(idx):
        return 0.0
    key = key_map[hand]
    # Elevation: how far below the mean wrist height (higher y = lower wrist = closer to pad)
    i_closest = idx[np.argmin(np.abs(motion.t[idx] - t))]
    y_val = float(motion.y[hand][i_closest])
    y_mean = float(motion.y[hand].mean()) if len(motion.y[hand]) else y_val
    elevation = max(0.0, y_val - y_mean)  # positive when wrist is below average
    # Recent downward velocity: max downward velocity in the lookback window
    vel_vals = motion.vel[hand][idx]
    max_down_vel = float(np.maximum(vel_vals, 0.0).max()) if len(vel_vals) else 0.0
    # Deceleration: negative acceleration at onset time (wrist stopping = impact)
    if len(idx) >= 2:
        accel = np.gradient(motion.vel[hand][idx], motion.t[idx])
        decel = float(np.maximum(-accel, 0.0).max())  # positive when decelerating
    else:
        decel = 0.0
    return (tune.hand_elevation_weight * elevation +
            tune.hand_velocity_weight * max_down_vel +
            tune.hand_decel_weight * decel)


def _fuse_audio_first(audio: dict, tracks: Tracks, av_offset_ms: float,
                       fps: float | None, tune) -> tuple[list[dict], dict, dict]:
    """Audio-first fusion: audio onsets are authoritative, video provides hand assignment.
    Every audio onset is a real strike. Video is queried for which hand played each one.
    Diddle pairs (two onsets on the same hand within diddle_max_ioi_ms) are handled:
    the second onset inherits the hand of the first when visual evidence is ambiguous.
    """
    onsets = audio["onsets"]
    times = [o["t"] for o in onsets]
    motion = _Motion(tracks, av_offset_ms)
    diddle_max = tune.diddle_max_ioi_ms / 1000.0
    # Also run classic strike detection for form metrics and as a check
    strikes = [{"t": s["t"] + av_offset_ms / 1000.0, "hand": s["hand"]} for s in detect_strikes(tracks)]
    requested_ms = float(tune.verify_window_ms)
    verify_ms = effective_verify_window(requested_ms, fps)
    matches, unmatched = match_strikes(times, strikes, verify_ms)

    strokes, last_by_hand = [], {}
    prev_hand, prev_t = None, -1.0
    for i, o in enumerate(onsets):
        match = matches.get(i)
        # Score both hands
        score_l = _score_hand_at(motion, o["t"], "L", tune)
        score_r = _score_hand_at(motion, o["t"], "R", tune)
        # If a matched strike exists, prefer its hand (strong visual evidence)
        if match and tune.hand_source == "strike_first":
            hand = strikes[match[0]]["hand"]
        elif abs(score_l - score_r) > 1e-6:
            hand = "L" if score_l > score_r else "R"
        else:
            # Tie-break: use _Motion.hand_at for velocity-based assignment
            hand = motion.hand_at(o["t"])
        # Diddle continuity: if this onset is very close to the previous one,
        # and the previous hand is known, keep the same hand (rebound stroke)
        if prev_hand and prev_t > 0 and (o["t"] - prev_t) < diddle_max:
            hand = prev_hand
        prev_hand = hand
        prev_t = o["t"]

        # Form metrics from the motion object
        height = awi = elbow = None
        if hand:
            prev_onset = last_by_hand.get(hand)
            start = prev_onset if prev_onset is not None and o["t"] - prev_onset <= CYCLE_MAX_S else o["t"] - FIRST_CYCLE_S
            height, awi = motion.cycle_metrics(hand, start, o["t"])
            elbow = motion.elbow_at(hand, o["t"])
            last_by_hand[hand] = o["t"]
        # In audio-first mode, every onset is "verified" since audio is ground truth.
        # But we still report which ones had a visual match for diagnostics.
        strokes.append({
            "t": o["t"], "hand": hand, "timing_error_ms": o["timing_error_ms"], "velocity": o["velocity"],
            "stroke_height": _r(height), "arm_vs_wrist_index": _r(awi), "elbow_angle_deg": _r(elbow, 2),
            "verification": "verified",  # audio-first: all onsets are verified
            "av_delta_ms": match[1] if match else None,
            "strike_hand": strikes[match[0]]["hand"] if match else None,
        })

    video_only = [{"t": round(strikes[j]["t"], 4), "hand": strikes[j]["hand"]} for j in sorted(unmatched)]
    # Build verification summary: in audio-first mode, all onsets are verified
    n_v = len(strokes)
    n_u = 0
    n_vo = len(video_only)
    total = n_v + n_vo
    # Tempo from all onsets (all verified in audio-first mode)
    bpm = None
    grid = audio.get("grid")
    if grid and n_v >= 4:
        t_arr = np.array([o["t"] for o in onsets])
        k_arr = np.array([o["grid_index"] for o in onsets])
        if len(set(k_arr)) >= 3:
            _, step = fit_grid(t_arr, k_arr)
            bpm = round(60.0 / (step * grid["subdivision"]), 2) if step > 0 else None
    errors = np.array([s["timing_error_ms"] for s in strokes if s["timing_error_ms"] is not None])
    deltas = [s["av_delta_ms"] for s in strokes if s["av_delta_ms"] is not None]
    # Also report classic match stats for diagnostics
    classic_verified = sum(1 for m in matches)
    verification = {
        "window_ms": verify_ms,
        "video_used": True,
        "video_strikes_detected": len(strikes),
        "verified_stroke_count": n_v,
        "unverified_onsets": n_u,
        "video_only_strikes": n_vo,
        "agreement_pct": round(100.0 * n_v / total, 2) if total else 0.0,
        "verified_tempo_bpm": bpm,
        "verified_timing": timing_stats(errors),
        "median_av_delta_ms": round(float(np.median(deltas)), 2) if deltas else None,
        "video_only": video_only,
        "note": None,
        "fusion_mode": "audio_first",
        "classic_visual_match_count": classic_verified,
        "classic_agreement_pct": round(100.0 * classic_verified / (classic_verified + (len(onsets) - classic_verified) + n_vo), 2) if (classic_verified + (len(onsets) - classic_verified) + n_vo) else 0.0,
        "window_requested_ms": requested_ms,
        "window_widened": verify_ms != requested_ms,
    }
    return strokes, verification, per_hand_form(strokes)

'''

fuse_target = 'def fuse(audio: dict, tracks: Tracks | None, degraded: bool, av_offset_ms: float = 0.0,'
content = content.replace(fuse_target, new_functions + fuse_target)

fuse_body_target = '''    onsets = audio["onsets"]
    times = [o["t"] for o in onsets]
    use_video = tracks is not None and not degraded and len(tracks.t) > 1
    motion = _Motion(tracks, av_offset_ms) if use_video else None'''

fuse_body_replacement = '''    onsets = audio["onsets"]
    times = [o["t"] for o in onsets]
    use_video = tracks is not None and not degraded and len(tracks.t) > 1

    # Audio-first fusion: audio is ground truth, video provides hand assignment
    if use_video and tune.fusion_mode == "audio_first":
        # Auto A/V sync if configured
        if tune.av_sync_method == "cross_correlate":
            auto_offset = compute_av_offset(audio, tracks, tune.av_sync_search_ms)
            av_offset_ms = float(av_offset_ms) + auto_offset
        return _fuse_audio_first(audio, tracks, av_offset_ms, fps, tune)

    motion = _Motion(tracks, av_offset_ms) if use_video else None'''
    
content = content.replace(fuse_body_target, fuse_body_replacement)

summ_target = '''        "video_only": video_only,
        "note": None if used_video else "Video was degraded or unavailable, so no onset could be verified.",
    }'''

summ_replacement = '''        "video_only": video_only,
        "note": None if used_video else "Video was degraded or unavailable, so no onset could be verified.",
        "fusion_mode": "classic",
    }'''

content = content.replace(summ_target, summ_replacement)

with open(r'C:\Users\epicn\Documents\sites\Stickitout\analyzer\app\fusion.py', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
