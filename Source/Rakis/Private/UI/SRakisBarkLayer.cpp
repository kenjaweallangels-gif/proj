#include "UI/SRakisBarkLayer.h"

#include "UI/RakisUIStyle.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"

namespace RakisBarkPrivate
{
	static float FontSizeFor(ERakisSubtitleSize InSize)
	{
		switch (InSize)
		{
		case ERakisSubtitleSize::S: return 14.f;
		case ERakisSubtitleSize::L: return 20.f;
		default: return 16.f;
		}
	}
}

void SRakisBarkLayer::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
	Font = FRakisUIStyle::GetFont(ERakisFontRole::Body, RakisBarkPrivate::FontSizeFor(ERakisSubtitleSize::M), 0, true);
}

void SRakisBarkLayer::ShowBark(const FText& Line, float Duration)
{
	LineString = Line.ToString();
	Remaining = FMath::Max(Duration, 0.5f);
	Remeasure();
}

void SRakisBarkLayer::SetAnchor(const FVector2f& NormalizedPos, float Distance01)
{
	// Вне экрана — прижимаем к полям 10 %.
	Anchor = FVector2f(FMath::Clamp(NormalizedPos.X, 0.1f, 0.9f), FMath::Clamp(NormalizedPos.Y, 0.15f, 0.8f));
	DistanceFade = FMath::Lerp(1.f, 0.45f, FMath::Clamp(Distance01, 0.f, 1.f));
}

void SRakisBarkLayer::SetSizePreset(ERakisSubtitleSize InSize)
{
	Font = FRakisUIStyle::GetFont(ERakisFontRole::Body, RakisBarkPrivate::FontSizeFor(InSize), 0, true);
	Remeasure();
}

void SRakisBarkLayer::Remeasure()
{
	if (!FSlateApplication::IsInitialized() || !FSlateApplication::Get().GetRenderer())
	{
		return;
	}
	const FVector2D Measured = FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(LineString, Font);
	TextSize = FVector2f(static_cast<float>(Measured.X), static_cast<float>(Measured.Y));
}

void SRakisBarkLayer::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	if (!bFrozen)
	{
		Remaining = FMath::Max(0.f, Remaining - Dt);
	}
	Opacity = FRakisUIStyle::StepFade(Opacity, Remaining > 0.f ? 1.f : 0.f, Dt, 0.2f, 0.5f);
}

int32 SRakisBarkLayer::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const float Alpha = FRakisUIStyle::EaseOut(Opacity) * DistanceFade * InWidgetStyle.GetColorAndOpacityTint().A;
	if (Alpha < 0.003f || LineString.IsEmpty())
	{
		return LayerId;
	}

	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const FVector2f Pos(
		static_cast<float>(LocalSize.X) * Anchor.X - TextSize.X * 0.5f,
		static_cast<float>(LocalSize.Y) * Anchor.Y - TextSize.Y);

	FSlateDrawElement::MakeText(OutDrawElements, LayerId,
		AllottedGeometry.ToPaintGeometry(TextSize, FSlateLayoutTransform(Pos + FVector2f(1.f, 1.5f))),
		LineString, Font, ESlateDrawEffect::None, FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), Alpha * 0.6f));
	FSlateDrawElement::MakeText(OutDrawElements, LayerId + 1,
		AllottedGeometry.ToPaintGeometry(TextSize, FSlateLayoutTransform(Pos)),
		LineString, Font, ESlateDrawEffect::None, FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), Alpha * 0.6f));
	return LayerId + 2;
}
