#include "UI/SRakisNoiseRipple.h"

#include "UI/RakisUIStyle.h"
#include "Rendering/DrawElements.h"

namespace RakisRipplePrivate
{
	static constexpr int32 NumArcs = 3;
	static constexpr int32 Segments = 32;		// точек на дугу: 33
	static constexpr float BaseRadius = 28.f;
	static constexpr float RadiusStep = 18.f;
	static constexpr float NoiseVisibleThreshold = 0.05f;
	static constexpr float NoiseGraceSeconds = 2.f;
	static constexpr float ThreatKeepsVisible = 0.25f;
}

void SRakisNoiseRipple::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
}

void SRakisNoiseRipple::SetValues(float InNoise01, float InThreat01, bool bInThreatActive, bool bInOnSand)
{
	TargetNoise = FMath::Clamp(InNoise01, 0.f, 1.f);
	Threat = FMath::Clamp(InThreat01, 0.f, 1.f);
	bThreatActive = bInThreatActive;
	bOnSand = bInOnSand;
}

void SRakisNoiseRipple::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	using namespace RakisRipplePrivate;
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	Time += Dt;

	Noise = FMath::FInterpTo(Noise, TargetNoise, Dt, 8.f);
	ThreatSmoothed = FMath::FInterpTo(ThreatSmoothed, Threat, Dt, 3.f);

	TimeSinceNoiseAbove = (TargetNoise >= NoiseVisibleThreshold) ? 0.f : TimeSinceNoiseAbove + Dt;

	// «Изменение» для правила авто-скрытия 3 с.
	if (FMath::Abs(TargetNoise - LastMarkedNoise) > 0.02f || FMath::Abs(Threat - LastMarkedThreat) > 0.05f)
	{
		LastMarkedNoise = TargetNoise;
		LastMarkedThreat = Threat;
		TimeSinceChange = 0.f;
	}
	else
	{
		TimeSinceChange += Dt;
	}

	const bool bThreatVisible = Threat >= ThreatKeepsVisible;
	const bool bWant = bOnSand
		&& (TimeSinceNoiseAbove < NoiseGraceSeconds || bThreatVisible)
		&& (TimeSinceChange < FRakisUIStyle::AutoHideDelay || bThreatVisible);

	Opacity = FRakisUIStyle::StepFade(Opacity, bWant ? 1.f : 0.f, Dt, 0.25f, 0.8f);
}

int32 SRakisNoiseRipple::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	using namespace RakisRipplePrivate;

	const float Alpha = FRakisUIStyle::EaseOut(Opacity) * InWidgetStyle.GetColorAndOpacityTint().A;
	if (Alpha < 0.003f)
	{
		return LayerId;
	}

	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const FVector2f Center(static_cast<float>(LocalSize.X) * 0.5f, static_cast<float>(LocalSize.Y));

	// Форма угрозы (цвето-независимый код): сужение раствора, дрожь, пульсация.
	const float Shape = bThreatActive ? FMath::Max(ThreatSmoothed, 0.3f) : ThreatSmoothed;
	const float HalfSpan = FMath::DegreesToRadians(60.f - 20.f * Shape);
	const float PulseFreq = 0.6f + 1.4f * Shape;
	const float Pulse = 0.5f + 0.5f * FMath::Sin(Time * UE_TWO_PI * PulseFreq);
	const float JitterAmp = 3.f * Shape;

	const FLinearColor Calm = FMath::Lerp(FRakisUIStyle::WarmWhite(), FRakisUIStyle::Ochre(), FMath::Clamp(Noise * 1.5f, 0.f, 1.f));
	const FLinearColor BaseColor = FMath::Lerp(Calm, FRakisUIStyle::OchreRed(), FMath::Clamp(ThreatSmoothed, 0.f, 1.f));
	const float Thickness = 1.0f + 1.6f * Noise + 0.5f * Shape;
	const FPaintGeometry PaintGeometry = AllottedGeometry.ToPaintGeometry();

	for (int32 Arc = 0; Arc < NumArcs; ++Arc)
	{
		const float ArcAlpha = 0.25f + 0.75f * FMath::Clamp((Noise - 0.25f * Arc) / 0.35f, 0.f, 1.f);
		const float Radius = BaseRadius + RadiusStep * Arc + Pulse * (1.5f + 4.f * Shape);

		// Массив передаётся во владение draw-элементу (MoveTemp) — одна аллокация на дугу, без копий.
		TArray<FVector2f> Points;
		Points.Reserve(Segments + 1);
		for (int32 S = 0; S <= Segments; ++S)
		{
			const float A = -UE_HALF_PI - HalfSpan + (2.f * HalfSpan) * (static_cast<float>(S) / Segments);
			const float R = Radius + JitterAmp * FMath::PerlinNoise1D(Time * 9.f + S * 0.37f + Arc * 5.1f);
			Points.Add(Center + FVector2f(FMath::Cos(A), FMath::Sin(A)) * R);
		}

		FSlateDrawElement::MakeLines(OutDrawElements, LayerId, PaintGeometry, MoveTemp(Points), ESlateDrawEffect::None,
			FRakisUIStyle::WithAlpha(BaseColor, Alpha * ArcAlpha), true, Thickness);
	}
	return LayerId + 1;
}

FVector2D SRakisNoiseRipple::ComputeDesiredSize(float LayoutScaleMultiplier) const
{
	return FVector2D(200.0, 72.0);
}
