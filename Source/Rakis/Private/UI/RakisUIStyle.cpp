#include "UI/RakisUIStyle.h"

#include "Rakis.h"
#include "Brushes/SlateColorBrush.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "Engine/Font.h"
#include "Input/Events.h"
#include "InputCoreTypes.h"
#include "Styling/CoreStyle.h"
#include "UObject/SoftObjectPath.h"

namespace RakisUIStylePrivate
{
	// Мягкие пути к шрифтам (OFL). Если ассетов нет — работает Roboto движка.
	static const TCHAR* TitleFontPath = TEXT("/Game/Rakis/UI/Fonts/Font_Cormorant.Font_Cormorant");
	static const TCHAR* BodyFontPath = TEXT("/Game/Rakis/UI/Fonts/Font_Inter.Font_Inter");

	static UFont* TitleFont = nullptr;
	static UFont* BodyFont = nullptr;
	static bool bFontsRequested = false;
	static bool bGamepadActive = false;

	static UFont* TryLoadFont(const TCHAR* Path)
	{
		const FSoftObjectPath SoftPath(Path);
		UFont* Font = Cast<UFont>(SoftPath.TryLoad());
		if (Font)
		{
			// Шрифт держим всю сессию: на него ссылаются только статические FSlateFontInfo.
			Font->AddToRoot();
		}
		else
		{
			UE_LOG(LogRakis, Log, TEXT("RakisUIStyle: font '%s' not found, using engine Roboto fallback"), Path);
		}
		return Font;
	}
}

const FLinearColor& FRakisUIStyle::Ochre()     { static const FLinearColor C(FColor(0xC8, 0xA1, 0x65)); return C; }
const FLinearColor& FRakisUIStyle::OchreRed()  { static const FLinearColor C(FColor(0xB5, 0x46, 0x2C)); return C; }
const FLinearColor& FRakisUIStyle::WarmWhite() { static const FLinearColor C(FColor(0xEF, 0xE6, 0xD8)); return C; }
const FLinearColor& FRakisUIStyle::ColdWhite() { static const FLinearColor C(FColor(0xDC, 0xE4, 0xEC)); return C; }
const FLinearColor& FRakisUIStyle::IbadBlue()  { static const FLinearColor C(FColor(0x6E, 0x9B, 0xC4)); return C; }
const FLinearColor& FRakisUIStyle::Ink()       { static const FLinearColor C(FColor(0x0B, 0x08, 0x05)); return C; }

void FRakisUIStyle::PreloadFonts()
{
	using namespace RakisUIStylePrivate;
	if (bFontsRequested)
	{
		return;
	}
	bFontsRequested = true;
	TitleFont = TryLoadFont(TitleFontPath);
	BodyFont = TryLoadFont(BodyFontPath);
}

FSlateFontInfo FRakisUIStyle::GetFont(ERakisFontRole Role, float Size, int32 LetterSpacing, bool bSoftOutline)
{
	using namespace RakisUIStylePrivate;

	FSlateFontInfo Info;
	switch (Role)
	{
	case ERakisFontRole::Title:
		Info = TitleFont ? FSlateFontInfo(TitleFont, Size, FName(TEXT("Light"))) : FCoreStyle::GetDefaultFontStyle("Light", Size);
		break;
	case ERakisFontRole::Body:
		Info = BodyFont ? FSlateFontInfo(BodyFont, Size, FName(TEXT("Regular"))) : FCoreStyle::GetDefaultFontStyle("Regular", Size);
		break;
	case ERakisFontRole::BodyLight:
		Info = BodyFont ? FSlateFontInfo(BodyFont, Size, FName(TEXT("Light"))) : FCoreStyle::GetDefaultFontStyle("Light", Size);
		break;
	case ERakisFontRole::Caps:
	default:
		Info = BodyFont ? FSlateFontInfo(BodyFont, Size, FName(TEXT("Medium"))) : FCoreStyle::GetDefaultFontStyle("Regular", Size);
		break;
	}

	Info.LetterSpacing = LetterSpacing;
	if (bSoftOutline)
	{
		// «Мягкая тень»: полупрозрачный контур вокруг глифов + обычная тень STextBlock.
		Info.OutlineSettings.OutlineSize = 2;
		Info.OutlineSettings.OutlineColor = WithAlpha(Ink(), 0.28f);
	}
	return Info;
}

const FSlateBrush* FRakisUIStyle::WhiteBrush()
{
	static const FSlateColorBrush Brush(FLinearColor::White);
	return &Brush;
}

const FSlateBrush* FRakisUIStyle::KeyGlyphBrush()
{
	static const FSlateRoundedBoxBrush Brush(FLinearColor::Transparent, 3.0f, FLinearColor::White, 1.0f);
	return &Brush;
}

bool FRakisUIStyle::IsGamepadActive()
{
	return RakisUIStylePrivate::bGamepadActive;
}

void FRakisUIStyle::SetGamepadActive(bool bGamepad)
{
	RakisUIStylePrivate::bGamepadActive = bGamepad;
}

// ---------------------------------------------------------------------------------------------
// FRakisInputDeviceDetector

bool FRakisInputDeviceDetector::HandleKeyDownEvent(FSlateApplication& SlateApp, const FKeyEvent& InKeyEvent)
{
	FRakisUIStyle::SetGamepadActive(InKeyEvent.GetKey().IsGamepadKey());
	return false;
}

bool FRakisInputDeviceDetector::HandleAnalogInputEvent(FSlateApplication& SlateApp, const FAnalogInputEvent& InAnalogInputEvent)
{
	// Порог 0.3 — дрейф стиков не переключает глифы.
	if (InAnalogInputEvent.GetKey().IsGamepadKey() && FMath::Abs(InAnalogInputEvent.GetAnalogValue()) > 0.3f)
	{
		FRakisUIStyle::SetGamepadActive(true);
	}
	return false;
}

bool FRakisInputDeviceDetector::HandleMouseMoveEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent)
{
	const FVector2D Delta = MouseEvent.GetCursorDelta();	// FDeprecateVector2DResult → FVector2D явно
	if (Delta.SizeSquared() > 4.0)
	{
		FRakisUIStyle::SetGamepadActive(false);
	}
	return false;
}

bool FRakisInputDeviceDetector::HandleMouseButtonDownEvent(FSlateApplication& SlateApp, const FPointerEvent& MouseEvent)
{
	FRakisUIStyle::SetGamepadActive(false);
	return false;
}
