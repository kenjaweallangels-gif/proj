import json

import pytest

from arcore.voice.commands import grammar, parse, parse_number


@pytest.mark.parametrize("text,cmd", [
    ("сборка дальше", "next"), ("Сборка, готово!", "next"), ("сборка назад", "prev"),
    ("сборка покажи кд", "kd"), ("сборка чертёж", "kd"), ("сборка ещё раз", "repeat"),
    ("сборка фото", "photo"), ("сборка не годно", "reject"),
])
def test_commands(text, cmd):
    assert parse(text)[0] == cmd


def test_wake_word_required():
    assert parse("дальше") is None
    assert parse("дальше", require_wake=False)[0] == "next"


@pytest.mark.parametrize("words,val", [
    ("шесть и восемь", 6.8), ("три", 3.0), ("двадцать пять", 25.0), ("1,5", 1.5), ("ноль точка три", 0.3)])
def test_numbers(words, val):
    assert parse_number(words.split()) == pytest.approx(val)


def test_value_command():
    assert parse("сборка один и два") == ("value", 1.2)


def test_grammar_is_json_list():
    g = json.loads(grammar())
    assert "сборка дальше" in g and "[unk]" in g
