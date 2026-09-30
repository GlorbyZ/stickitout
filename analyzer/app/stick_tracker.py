import math
import numpy as np
from typing import Dict, Tuple, List, Optional

def angle_delta(a: float, b: float) -> float:
    """Calculate the shortest angle difference between two angles in radians."""
    d = a - b
    while d > math.pi:
        d -= math.pi * 2
    while d < -math.pi:
        d += math.pi * 2
    return d

def one_euro_alpha(cutoff: float, dt: float) -> float:
    """Calculate the alpha smoothing factor for a OneEuro filter."""
    if dt <= 0:
        return 1.0
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)

class StickTracker:
    """Tracker for finding and smoothing drumstick tips from video frames."""
    
    def __init__(self):
        """Initialize the tracker state."""
        self.prev_gray: Optional[np.ndarray] = None
        self.tip_states: Dict[str, Optional[dict]] = {"L": None, "R": None}
        
    def reset(self):
        """Clear the tracker state."""
        self.prev_gray = None
        self.tip_states = {"L": None, "R": None}
        
    def _sample_at(self, gray: np.ndarray, w: int, h: int, x: float, y: float) -> float:
        """Sample a pixel from a 2D grayscale array, returning -1 if out of bounds."""
        xi, yi = int(x), int(y)
        if xi < 0 or yi < 0 or xi >= w or yi >= h:
            return -1.0
        return float(gray[yi, xi])
        
    def _smooth_tip(self, side: str, raw: dict, t: float) -> Tuple[float, float]:
        """Low lag on a fast stroke, steady when the stick is sitting still."""
        s = self.tip_states[side]
        if not s or not (t > s["t"]) or t - s["t"] > 0.25:
            self.tip_states[side] = {
                "x": raw["x"], "y": raw["y"],
                "dx": 0.0, "dy": 0.0,
                "t": t,
                "angle": raw["angle"],
                "length": raw["length"]
            }
            return (raw["x"], raw["y"])
            
        dt = t - s["t"]
        ad = one_euro_alpha(1.0, dt)
        s["dx"] += ad * ((raw["x"] - s["x"]) / dt - s["dx"])
        s["dy"] += ad * ((raw["y"] - s["y"]) / dt - s["dy"])
        
        speed = math.hypot(s["dx"], s["dy"])
        a = one_euro_alpha(1.15 + speed * 7.0, dt)
        s["t"] = t
        # Angle and length follow slowly. The tip is then placed on that rigid shaft
        # so a bad frame cannot slide the tip off the stick.
        s["angle"] += angle_delta(raw["angle"], s["angle"]) * 0.40
        s["length"] += (raw["length"] - s["length"]) * 0.05
        gx = raw["x"] - raw["length"] * math.cos(raw["angle"])
        gy = raw["y"] - raw["length"] * math.sin(raw["angle"])
        s["x"] = gx + s["length"] * math.cos(s["angle"])
        s["y"] = gy + s["length"] * math.sin(s["angle"])
        return (s["x"], s["y"])
        
    def _score_ray(self, gray: np.ndarray, previous: Optional[np.ndarray], w: int, h: int, ox: float, oy: float, ang: float, hand_len: float, prior: Optional[dict]) -> Optional[dict]:
        """Walk along a ray and score it based on edge contrast and motion delta."""
        ux = math.cos(ang)
        uy = math.sin(ang)
        px = -uy
        py = ux
        
        start = hand_len * 0.4
        max_dist = hand_len * 4.4
        
        score = 0.0
        tip_dist = 0.0
        gap = 0
        seen = 0
        
        dist = start
        while dist <= max_dist:
            x = ox + ux * dist
            y = oy + uy * dist
            
            c = self._sample_at(gray, w, h, x, y)
            left = self._sample_at(gray, w, h, x + px * 3.0, y + py * 3.0)
            right = self._sample_at(gray, w, h, x - px * 3.0, y - py * 3.0)
            
            if c < 0 or left < 0 or right < 0:
                break
                
            contrast = abs(c - (left + right) * 0.5)
            motion = 0.0
            
            if previous is not None:
                prev = self._sample_at(previous, w, h, x, y)
                if prev >= 0:
                    motion = abs(c - prev)
                    
            if contrast > 10.0 or motion > 18.0:
                reach = (dist - start) / hand_len
                score += (contrast + motion * 0.4) * (0.4 + reach)
                tip_dist = dist
                gap = 0
                seen += 1
            elif seen > 0:
                gap += 1
                if gap > 12:
                    break
                    
            dist += 2.0
            
        if seen < 4 or tip_dist < hand_len * 0.9:
            return None
            
        if prior is not None and prior["length"] > 0:
            d_ang = abs(angle_delta(ang, prior["angle"]))
            d_len = abs(tip_dist - prior["length"]) / prior["length"]
            score += max(0.0, 160.0 - d_ang * 210.0)
            score -= min(140.0, d_len * 160.0)
            
        return {"score": score, "tipDist": tip_dist, "ang": ang}

    def _ray_tip(self, gray: np.ndarray, previous: Optional[np.ndarray], w: int, h: int, wrist: Tuple[float, float], grip: Tuple[float, float], hand_landmarks: list, prior: Optional[dict]) -> Optional[dict]:
        """Find the stick tip by casting a fan of rays from the grip point."""
        wx, wy = wrist
        gx, gy = grip
        
        # Calculate base angle from the knuckle line (index_mcp to pinky_mcp)
        # The drumstick is naturally held perpendicular to the knuckles in most grips.
        index_mcp = (float(hand_landmarks[5][0]), float(hand_landmarks[5][1]))
        pinky_mcp = (float(hand_landmarks[17][0]), float(hand_landmarks[17][1]))
        
        kx = pinky_mcp[0] - index_mcp[0]
        ky = pinky_mcp[1] - index_mcp[1]
        
        # Perpendicular vector to knuckles
        nx, ny = -ky, kx
        
        # Ensure it points away from the wrist
        if (nx * (gx - wx) + ny * (gy - wy)) < 0:
            nx, ny = -nx, -ny
            
        hand_len = math.hypot(gx - wx, gy - wy)
        if hand_len < 4.0:
            return None
            
        # The base search angle is the robust knuckle normal
        base = math.atan2(ny, nx)
        best = None
        
        def consider(ang: float):
            nonlocal best
            hit = self._score_ray(gray, previous, w, h, gx, gy, ang, hand_len, prior)
            if hit is not None and (best is None or hit["score"] > best["score"]):
                best = hit
                
        # Phase 1: Coarse sweep
        for deg in np.arange(-56, 56.1, 4.0):
            consider(base + deg * math.pi / 180.0)
            
        # Phase 2: Fine sweep
        if best is not None:
            for deg in np.arange(-8, 8.1, 1.5):
                consider(best["ang"] + deg * math.pi / 180.0)
                
        # Phase 3: Prior sweep
        if prior is not None:
            for deg in np.arange(-14, 14.1, 1.5):
                consider(prior["angle"] + deg * math.pi / 180.0)
                
        if best is None or best["score"] < 70.0:
            return None
            
        ux = math.cos(best["ang"])
        uy = math.sin(best["ang"])
        
        return {
            "x": gx + ux * best["tipDist"],
            "y": gy + uy * best["tipDist"],
            "angle": best["ang"],
            "length": best["tipDist"]
        }

    def track_frame(self, gray: np.ndarray, hands: list, pose_wrists: dict, t: float) -> dict:
        """Process a frame and track stick tips. Returns left and right tip coordinates."""
        h, w = gray.shape
        out: Dict[str, Optional[Tuple[float, float]]] = {"L": None, "R": None}
        
        previous = self.prev_gray
        self.prev_gray = gray.copy()
        
        if previous is None or previous.shape != gray.shape:
            # Return current tip states if they exist
            for side in ["L", "R"]:
                if self.tip_states[side] is not None:
                    out[side] = (self.tip_states[side]["x"], self.tip_states[side]["y"])
            return out
            
        ranked = []
        for hand in hands:
            wrist = (float(hand[0][0]), float(hand[0][1]))
            index_mcp = (float(hand[5][0]), float(hand[5][1]))
            middle_mcp = (float(hand[9][0]), float(hand[9][1]))
            
            grip = (
                index_mcp[0] * 0.45 + middle_mcp[0] * 0.55,
                index_mcp[1] * 0.45 + middle_mcp[1] * 0.55
            )
            
            dl = math.hypot(wrist[0] - pose_wrists["lw"][0], wrist[1] - pose_wrists["lw"][1])
            dr = math.hypot(wrist[0] - pose_wrists["rw"][0], wrist[1] - pose_wrists["rw"][1])
            
            side = "L" if dl <= dr else "R"
            dist = min(dl, dr)
            ranked.append({"wrist": wrist, "grip": grip, "hand": hand, "side": side, "dist": dist})
            
        ranked.sort(key=lambda x: x["dist"])
        
        used = set()
        for item in ranked:
            side = item["side"]
            if side in used:
                side = "R" if side == "L" else "L"
            if side in used:
                continue
                
            used.add(side)
            
            measured = self._ray_tip(gray, previous, w, h, item["wrist"], item["grip"], item["hand"], self.tip_states[side])
            
            if measured is not None:
                out[side] = self._smooth_tip(side, measured, t)
            elif self.tip_states[side] is not None and t - self.tip_states[side]["t"] < 0.07:
                dt = max(0.0, t - self.tip_states[side]["t"])
                ts = self.tip_states[side]
                x_pred = ts["x"] + ts["dx"] * dt * 0.35
                y_pred = ts["y"] + ts["dy"] * dt * 0.35
                out[side] = (x_pred, y_pred)
                
        return out


def rts_smooth_tips(tips_L: list, tips_R: list, times: np.ndarray) -> Tuple[list, list]:
    """
    Bidirectional exponential smoothing pass for offline zero lag correction.
    Applies a forward and backward smoothing pass to combine predictions.
    """
    def smooth_pass(tips, t_arr, reverse=False):
        n = len(tips)
        out = [None] * n
        indices = range(n - 1, -1, -1) if reverse else range(n)
        
        state = None
        for i in indices:
            pt = tips[i]
            t = t_arr[i]
            if pt is None:
                state = None
                continue
                
            if state is None:
                state = {"x": pt[0], "y": pt[1], "t": t}
                out[i] = pt
            else:
                dt = abs(t - state["t"])
                alpha = one_euro_alpha(3.0, dt) if dt > 0 else 1.0
                x = state["x"] + alpha * (pt[0] - state["x"])
                y = state["y"] + alpha * (pt[1] - state["y"])
                state = {"x": x, "y": y, "t": t}
                out[i] = (x, y)
        return out

    def combine(fwd, bwd):
        out = []
        for f, b in zip(fwd, bwd):
            if f is not None and b is not None:
                out.append(((f[0] + b[0]) * 0.5, (f[1] + b[1]) * 0.5))
            elif f is not None:
                out.append(f)
            elif b is not None:
                out.append(b)
            else:
                out.append(None)
        return out

    fwd_L = smooth_pass(tips_L, times, reverse=False)
    bwd_L = smooth_pass(tips_L, times, reverse=True)
    fwd_R = smooth_pass(tips_R, times, reverse=False)
    bwd_R = smooth_pass(tips_R, times, reverse=True)
    
    return combine(fwd_L, bwd_L), combine(fwd_R, bwd_R)

