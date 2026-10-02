#pragma once

#include "CoreMinimal.h"
#include "Fonts/SlateFontInfo.h"
#include "Framework/Application/IInputProcessor.h"
#include "Input/Events.h"

struct FSlateBrush;

/** Роли шрифтов интерфейса (см. docs/ui/ui_design.md §3). */
enum class ERakisFontRole : uint8
{
	Title,		// титры глав, надписи-лор, концовка (цель: Cormorant Garamond Light)
	Body,		// субтитры, подсказки (цель: Inter Regular)
	BodyLight,	// меню, легенды (цель: Inter Light)
	Caps		// имя говорящего, глиф клавиши (цель: Inter Medium)
};

/**
 * Централизованный стиль UI: палитра, шрифты, кисти, тайминги.
 * Шрифты: пока используется Roboto движка; при наличии UFont-ассетов
 *   /Game/Rakis/UI/Fonts/Font_Cormorant (typeface "Light")
 *   /Game/Rakis/UI/Fonts/Font_Inter (typefaces "Light", "Regular", "Medium")
 * они подхватываются автоматически (PreloadFonts вызывается из ARakisHUD::BeginPlay).
 */
class RAKIS_API FRakisUIStyle
{
public:
	// --- Палитра (sRGB hex → FLinearColor) ---
	static const FLinearColor& Ochre();		// #C8A165
	static const FLinearColor& OchreRed();	// #B5462C
	static const FLinearColor& WarmWhite();	// #EFE6D8
	static const FLinearColor& ColdWhite();	// #DCE4EC
	static const FLinearColor& IbadBlue();	// #6E9BC4
	static const FLinearColor& Ink();		// #0B0805

	/** Цвет с заданной альфой. */
	static FLinearColor WithAlpha(const FLinearColor& C, float Alpha) { return FLinearColor(C.R, C.G, C.B, C.A * Alpha); }

	// --- Шрифты ---
	/** Грузит UFont-ассеты по мягким путям (один раз). Безопасно вызывать многократно. */
	static void PreloadFonts();
	/** Шрифт роли заданного кегля (единицы Slate). LetterSpacing — в 1/1000 em. */
	static FSlateFontInfo GetFont(ERakisFontRole Role, float Size, int32 LetterSpacing = 0, bool bSoftOutline = false);

	// --- Кисти (статические, без UObject) ---
	static const FSlateBrush* WhiteBrush();
	static const FSlateBrush* KeyGlyphBrush();	// скруглённая рамка 1 px

	// --- Устройство ввода ---
	static bool IsGamepadActive();
	static void SetGamepadActive(bool bGamepad);

	// --- Общие константы ---
	static constexpr float AutoHideDelay = 3.0f;

	/** Сглаживание «ease-out» для появления. */
	static float EaseOut(float T) { T = FMath::Clamp(T, 0.f, 1.f); return 1.f - (1.f - T) * (1.f - T); }
	static float EaseInOut(float T) { T = FMath::Clamp(T, 0.f, 1.f); return T * T * (3.f - 2.f * T); }

	/** Линейное приближение значения к цели с разными скоростями появления/исчезновения. */
	static float StepFade(float Current, float Target, float DeltaTime, float FadeIn, float FadeOut)
	{
		if (Target > Current)
		{
			return FMath::Min(Target, Current + (FadeIn > KINDA_SMALL_NUMBER ? DeltaTime / FadeIn : 1.f));
		}
		return FMath::Max(Target, Current - (FadeOut > KINDA_SMALL_NUMBER ? DeltaTime / FadeOut : 1.f));
	}
};

/**
 * Препроцессор ввода Slate: запоминает последнее устройство (клавиатура/мышь или геймпад),
 * чтобы показывать правильные глифы (E ↔ X). Ничего не поглощает.
 */
class RAKIS_API FRakisInputDeviceDetector : public IInputProcessor
{
public:
	virtual void Tick(const float DeltaTime, FSlateApplication& SlateApp, TSharedRef<ICursor> Cursor) override {}
	virtual bool HandleKeyDownEvent(FSlateApplication& SlateApp, const FKeyEvent& InKeyEvent) override;
	virtual bool HandleAnalogInputEvent(FSlateApplication& SlateApp, const FAnalogInputEvent& InAnalogInputEvent) override;
	virtual bool HandleMouseMoveEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override;
	virtual bool HandleMouseButtonDownEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent) override;
	// GetDebugName() не переопределяем: необязателен, а его const-квалификация менялась между версиями.
};
