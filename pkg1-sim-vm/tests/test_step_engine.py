from arcore.steps.engine import State, StepEngine


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make(op040):
    c = Clock()
    e = StepEngine(op040, clock=c)
    e.start()
    return e, c


def test_align_then_steps(op040):
    e, _ = make(op040)
    assert e.state == State.ALIGNING
    assert not e.command("next")                       # без привязки нельзя
    e.on_anchor(0.9)
    assert e.state == State.SHOWING
    for _ in range(5):
        assert e.command("next")
    assert e.step["id"] == "S6"
    assert not e.command("next") and e.state == State.WAITING_PHOTO   # критичный шаг требует фото
    assert e.command("photo") and e.state == State.DONE
    assert e.log[-1].event == "operation_done"


def test_align_timeout_manual(op040):
    e, c = make(op040)
    c.t = 25
    e.tick()
    assert e.state == State.MANUAL_ALIGN
    assert e.command("manual_aligned") and e.state == State.SHOWING


def test_value_check(op040):
    data = dict(op040)
    steps = [dict(s) for s in op040["steps"]]
    steps[1]["confirm"] = "value"                      # момент 1.2 Н·м ± 10 %
    data["steps"] = steps
    e, _ = make(data)
    e.on_anchor(1.0)
    e.command("next")
    assert not e.command("next") and e.state == State.WAITING_VALUE
    assert not e.command("value", 2.0)                 # вне допуска
    assert e.command("value", 1.25) and e.step["id"] == "S3"


def test_over_norm_logged_once(op040):
    e, c = make(op040)
    e.on_anchor(1.0)
    e.command("next")
    c.t = 1000
    e.tick(); e.tick()
    assert sum(1 for x in e.log if x.event == "over_norm") == 1


def test_speed_bounds_and_prev(op040):
    e, _ = make(op040)
    for _ in range(5):
        e.command("faster")
    assert e.speed == 2.0
    e.on_anchor(1.0); e.command("next"); e.command("prev")
    assert e.index == 0
    assert e.message()["total"] == len(op040["steps"])
