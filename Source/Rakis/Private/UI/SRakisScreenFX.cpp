#include "UI/SRakisScreenFX.h"

#include "UI/RakisUIStyle.h"
#include "Rendering/DrawElements.h"

namespace RakisScreenFXPrivate
{
	static constexpr float CinemaAspect = 2.35f;
	static constexpr float LetterboxSeconds = 0.8f;
}

void SRakisScreenFX::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
}

void SRakisScreenFX::FadeTo(float TargetAlpha, float Seconds)
{
	FadeTarget = FMath::Clamp(TargetAlpha, 0.f, 1.f);
	if (Seconds <= KINDA_SMALL_NUMBER)
	{
		FadeAlpha = FadeTarget;
		return;
	}
	FadeSpeed = FMath::Max(FMath::Abs(FadeTarget - FadeAlpha), 0.01f) / Seconds;
}

void SRakisScreenFX::SetFadeImmediate(float Alpha)
{
	FadeAlpha = FadeTarget = FMath::Clamp(Alpha, 0.f, 1.f);
}

void SRakisScreenFX::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	FadeAlpha = FMath::FInterpConstantTo(FadeAlpha, FadeTarget, Dt, FadeSpeed);
	Letterbox01 = FRakisUIStyle::StepFade(Letterbox01, bLetterbox ? 1.f : 0.f, Dt,
		RakisScreenFXPrivate::LetterboxSeconds, RakisScreenFXPrivate::LetterboxSeconds);
}

int32 SRakisScreenFX::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const float W = static_cast<float>(LocalSize.X);
	const float H = static_cast<float>(LocalSize.Y);
	const float Tint = InWidgetStyle.GetColorAndOpacityTint().A;

	// Леттербокс 2.35:1 (выезд с ease in-out).
	const float BarFull = FMath::Max(0.f, (H - W / RakisScreenFXPrivate::CinemaAspect) * 0.5f);
	const float Bar = BarFull * FRakisUIStyle::EaseInOut(Letterbox01);
	if (Bar > 0.25f)
	{
		const FLinearColor Black(0.f, 0.f, 0.f, Tint);
		FSlateDrawElement::MakeBox(OutDrawElements, LayerId,
			AllottedGeometry.ToPaintGeometry(FVector2f(W, Bar), FSlateLayoutTransform(FVector2f(0.f, 0.f))),
			FRakisUIStyle::WhiteBrush(), ESlateDrawEffect::None, Black);
		FSlateDrawElement::MakeBox(OutDrawElements, LayerId,
			AllottedGeometry.ToPaintGeometry(FVector2f(W, Bar), FSlateLayoutTransform(FVector2f(0.f, H - Bar))),
			FRakisUIStyle::WhiteBrush(), ESlateDrawEffect::None, Black);
	}

	// Затемнение.
	if (FadeAlpha > 0.002f)
	{
		FSlateDrawElement::MakeBox(OutDrawElements, LayerId + 1,
			AllottedGeometry.ToPaintGeometry(),
			FRakisUIStyle::WhiteBrush(), ESlateDrawEffect::None, FLinearColor(0.f, 0.f, 0.f, FadeAlpha * Tint));
	}
	return LayerId + 2;
}
