; Управление сборкой из любой программы (Windows, AutoHotkey v2).
; Браузер не может ловить клавиши, пока активен CAD/Excel. Этот скрипт ловит F13–F18 (или назначьте свои)
; глобально и пересылает нужные клавиши в окно сборки, не переключая фокус надолго.
; 1. Установите AutoHotkey v2 (autohotkey.com). 2. Откройте «Сборка» → «Закрепить окно поверх».
; 3. Запустите этот файл двойным кликом. Назначьте на педаль/нумпад F13–F18 (в софте педали/клавиатуры).

#Requires AutoHotkey v2.0
#SingleInstance Force

TitleMatch := "Сборка"            ; часть заголовка закреплённого окна / вкладки
SetTitleMatchMode 2

SendToAssembly(key) {
    prev := WinExist("A")
    if WinExist(TitleMatch) {
        WinActivate
        Sleep 60
        Send key
        Sleep 40
        if prev
            WinActivate "ahk_id " prev   ; вернуть фокус туда, где работали
    } else {
        TrayTip "Окно сборки не найдено", "Откройте «Сборка» → «Закрепить окно поверх»", 2
    }
}

F13::SendToAssembly("{Space}")      ; сделано / пуск-пауза
F14::SendToAssembly("{Backspace}")  ; назад
F15::SendToAssembly("s")            ; пропустить
F16::SendToAssembly("{Right}")      ; следующий
F17::SendToAssembly("{Left}")       ; предыдущий
F18::SendToAssembly("r")            ; направление сборка/разборка
; Пример для нумпада, если F13+ недоступны (раскомментируйте):
; ^Numpad0::SendToAssembly("{Space}")
; ^NumpadDot::SendToAssembly("{Backspace}")
