#include "UI/SRakisInteractPrompt.h"

#include "UI/RakisUIStyle.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"

namespace RakisPromptPrivate
{
	static constexpr float DotSize = 2.f;
	static constexpr float GlyphSize = 18.f;
	static constexpr float GlyphOffsetX = 22.f;	// от центра экрана
	static constexpr float VerbGap = 8.f;
}

void SRakisInteractPrompt::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
	VerbFont = FRakisUIStyle::GetFont(ERakisFontRole::Body, 16.f, 60, true);
	KeyFont = FRakisUIStyle::GetFont(ERakisFontRole::Caps, 11.f);
	bGamepadShown = FRakisUIStyle::IsGamepadActive();
	KeyString = bGamepadShown ? TEXT("X") : TEXT("E");
	RefreshMeasurements();
}

void SRakisInteractPrompt::SetFocus(bool bHasFocus, const FText& Verb)
{
	bFocus = bHasFocus;
	if (bHasFocus)
	{
		const FString NewVerb = Verb.ToString();
		if (NewVerb != VerbString)
		{
			VerbString = NewVerb;
			RefreshMeasurements();
		}
	}
}

void SRakisInteractPrompt::RefreshMeasurements()
{
	// Измеряем текст только при смене строки/устройства — не в OnPaint.
	if (!FSlateApplication::IsInitialized() || !FSlateApplication::Get().GetRenderer())
	{
		return;
	}
	const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
	const auto Verb = Measure->Measure(VerbString, VerbFont);
	const auto Key = Measure->Measure(KeyString, KeyFont);
	VerbSize = FVector2f(static_cast<float>(Verb.X), static_cast<float>(Verb.Y));
	KeySize = FVector2f(static_cast<float>(Key.X), static_cast<float>(Key.Y));
}

void SRakisInteractPrompt::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const bool bGamepad = FRakisUIStyle::IsGamepadActive();
	if (bGamepad != bGamepadShown)
	{
		bGamepadShown = bGamepad;
		KeyString = bGamepad ? TEXT("X") : TEXT("E");
		RefreshMeasurements();
	}
	const bool bWant = bFocus && !bSuppressed;
	Opacity = FRakisUIStyle::StepFade(Opacity, bWant ? 1.f : 0.f, FMath::Min(InDeltaTime, 0.1f), 0.15f, 0.25f);
}

int32 SRakisInteractPrompt::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	using namespace RakisPromptPrivate;

	const float Alpha = FRakisUIStyle::EaseOut(Opacity) * InWidgetStyle.GetColorAndOpacityTint().A;
	if (Alpha < 0.003f)
	{
		return LayerId;
	}

	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const FVector2f Center(static_cast<float>(LocalSize.X) * 0.5f, static_cast<float>(LocalSize.Y) * 0.5f);
	const FLinearColor White = FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), Alpha * 0.9f);
	const FLinearColor ShadowColor = FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), Alpha * 0.6f);

	// Точка 2 px.
	FSlateDrawElement::MakeBox(OutDrawElements, LayerId,
		AllottedGeometry.ToPaintGeometry(FVector2f(DotSize, DotSize), FSlateLayoutTransform(Center - FVector2f(DotSize * 0.5f))),
		FRakisUIStyle::WhiteBrush(), ESlateDrawEffect::None, White);

	// Глиф клавиши: скруглённая рамка + буква.
	const FVector2f GlyphPos(Center.X + GlyphOffsetX, Center.Y - GlyphSize * 0.5f);
	FSlateDrawElement::MakeBox(OutDrawElements, LayerId,
		AllottedGeometry.ToPaintGeometry(FVector2f(GlyphSize, GlyphSize), FSlateLayoutTransform(GlyphPos)),
		FRakisUIStyle::KeyGlyphBrush(), ESlateDrawEffect::None, FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), Alpha * 0.7f));

	const FVector2f KeyPos = GlyphPos + (FVector2f(GlyphSize, GlyphSize) - KeySize) * 0.5f;
	FSlateDrawElement::MakeText(OutDrawElements, LayerId + 1,
		AllottedGeometry.ToPaintGeometry(KeySize, FSlateLayoutTransform(KeyPos)),
		KeyString, KeyFont, ESlateDrawEffect::None, White);

	// Глагол (с тенью).
	if (!VerbString.IsEmpty())
	{
		const FVector2f VerbPos(GlyphPos.X + GlyphSize + VerbGap, Center.Y - VerbSize.Y * 0.5f);
		FSlateDrawElement::MakeText(OutDrawElements, LayerId,
			AllottedGeometry.ToPaintGeometry(VerbSize, FSlateLayoutTransform(VerbPos + FVector2f(1.f, 1.5f))),
			VerbString, VerbFont, ESlateDrawEffect::None, ShadowColor);
		FSlateDrawElement::MakeText(OutDrawElements, LayerId + 1,
			AllottedGeometry.ToPaintGeometry(VerbSize, FSlateLayoutTransform(VerbPos)),
			VerbString, VerbFont, ESlateDrawEffect::None, White);
	}
	return LayerId + 2;
}
