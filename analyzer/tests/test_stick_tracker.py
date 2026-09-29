import math
import numpy as np
import pytest

from app.stick_tracker import (
    StickTracker,
    one_euro_alpha,
    rts_smooth_tips,
)

def test_score_ray_finds_bright_line():
    gray = np.zeros((200, 200), dtype=np.float32)
    x, y = 100, 100
    for i in range(80):
        gray[int(y), int(x + i)] = 200.0

    tracker = StickTracker()
    result = tracker._score_ray(gray, None, 200, 200, 100.0, 100.0, 0.0, 30.0, None)
    assert result is not None
    assert result["score"] > 0

def test_score_ray_rejects_empty_image():
    gray = np.full((200, 200), 128.0, dtype=np.float32)
    tracker = StickTracker()
    result = tracker._score_ray(gray, None, 200, 200, 100.0, 100.0, 0.0, 30.0, None)
    assert result is None

def test_ray_tip_finds_stick_in_fan():
    gray = np.zeros((300, 300), dtype=np.float32)
    gx, gy = 150, 150
    ang = 30 * math.pi / 180
    for i in range(100):
        gray[int(gy + i * math.sin(ang)), int(gx + i * math.cos(ang))] = 200.0

    tracker = StickTracker()
    result = tracker._ray_tip(gray, None, 300, 300, (120.0, 170.0), (150.0, 150.0), None)
    assert result is not None
    
    expected_x = gx + 100 * math.cos(ang)
    expected_y = gy + 100 * math.sin(ang)
    
    dist = math.hypot(result["x"] - expected_x, result["y"] - expected_y)
    assert dist < 30.0

def test_smooth_tip_reduces_jitter():
    tracker = StickTracker()
    base_x, base_y = 100.0, 100.0
    
    tracker._smooth_tip("L", {"x": base_x, "y": base_y, "angle": 0.0, "length": 50.0}, 0.0)
    
    inputs_x = []
    smoothed_x = []
    
    for i in range(1, 11):
        noise = (np.random.random() - 0.5) * 6.0
        raw_x = base_x + noise
        inputs_x.append(raw_x)
        
        sx, _ = tracker._smooth_tip("L", {"x": raw_x, "y": base_y, "angle": 0.0, "length": 50.0}, i * 0.016)
        smoothed_x.append(sx)
        
    var_in = np.var(inputs_x)
    var_out = np.var(smoothed_x)
    assert var_out < var_in

def test_one_euro_alpha_bounds():
    assert 0.0 <= one_euro_alpha(1.0, 0.016) <= 1.0
    assert 0.0 <= one_euro_alpha(10.0, 0.016) <= 1.0
    assert 0.0 <= one_euro_alpha(1.0, 0.5) <= 1.0

def test_rts_smooth_preserves_length():
    tips = [(100.0, 100.0)] * 50
    times = np.linspace(0, 1, 50)
    
    tips_with_none = list(tips)
    tips_with_none[25] = None
    
    out_l, out_r = rts_smooth_tips(tips_with_none, tips, times)
    assert len(out_l) == 50
    assert len(out_r) == 50
    assert out_l[25] is None

def test_tracker_returns_none_with_no_hands():
    gray = np.zeros((200, 200), dtype=np.float32)
    tracker = StickTracker()
    res = tracker.track_frame(gray, [], {"lw": (50, 50), "rw": (150, 50)}, 0.0)
    assert res["L"] is None
    assert res["R"] is None
