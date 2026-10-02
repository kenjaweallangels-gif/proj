#include "UI/SRakisRhythmTicks.h"

#include "UI/RakisUIStyle.h"
#include "Rendering/DrawElements.h"

namespace RakisTicksPrivate
{
	static constexpr float Width = 96.f;
	static constexpr float Height = 12.f;
	static constexpr float TickWidth = 1.2f;
	static constexpr float MinTickHeight = 5.f;
	static constexpr float MaxTickHeight = 9.f;
}

void SRakisRhythmTicks::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
	for (int32 Index = 0; Index < NumTicks; ++Index)
	{
		TargetPositions[Index] = Positions[Index] = static_cast<float>(Index) / (NumTicks - 1);
		TargetHeights[Index] = Heights[Index] = RakisTicksPrivate::MinTickHeight;
	}
}

void SRakisRhythmTicks::SetValues(bool bInSandWalking, float InRegularity01, const TArray<float>& InIntervals)
{
	using namespace RakisTicksPrivate;
	bSandWalking = bInSandWalking;
	TargetRegularity = FMath::Clamp(InRegularity01, 0.f, 1.f);

	// Берём последние ≤ 5 интервалов: 6 засечек → 5 промежутков.
	constexpr int32 NumGaps = NumTicks - 1;
	float Gaps[NumGaps];
	const int32 Available = FMath::Min(InIntervals.Num(), NumGaps);
	float Sum = 0.f;
	for (int32 Index = 0; Index < NumGaps; ++Index)
	{
		// Недостающие интервалы — равномерные (среднее известных или 1).
		const int32 SourceIndex = InIntervals.Num() - Available + (Index - (NumGaps - Available));
		const bool bHas = Index >= NumGaps - Available && InIntervals.IsValidIndex(SourceIndex);
		Gaps[Index] = bHas ? FMath::Max(InIntervals[SourceIndex], 0.01f) : -1.f;
		if (bHas)
		{
			Sum += Gaps[Index];
		}
	}
	const float Mean = Available > 0 ? Sum / Available : 1.f;
	Sum = 0.f;
	for (int32 Index = 0; Index < NumGaps; ++Index)
	{
		if (Gaps[Index] < 0.f)
		{
			Gaps[Index] = Mean;
		}
		Sum += Gaps[Index];
	}

	float Accum = 0.f;
	TargetPositions[0] = 0.f;
	TargetHeights[0] = MinTickHeight;
	for (int32 Index = 0; Index < NumGaps; ++Index)
	{
		Accum += Gaps[Index];
		TargetPositions[Index + 1] = Sum > KINDA_SMALL_NUMBER ? Accum / Sum : static_cast<float>(Index + 1) / NumGaps;
		const float Deviation = Mean > KINDA_SMALL_NUMBER ? FMath::Abs(Gaps[Index] - Mean) / Mean : 0.f;
		TargetHeights[Index + 1] = FMath::Lerp(MinTickHeight, MaxTickHeight, FMath::Clamp(Deviation * 2.5f, 0.f, 1.f));
	}
}

void SRakisRhythmTicks::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	Regularity = FMath::FInterpTo(Regularity, TargetRegularity, Dt, 6.f);
	for (int32 Index = 0; Index < NumTicks; ++Index)
	{
		Positions[Index] = FMath::FInterpTo(Positions[Index], TargetPositions[Index], Dt, 10.f);
		Heights[Index] = FMath::FInterpTo(Heights[Index], TargetHeights[Index], Dt, 10.f);
	}
	Opacity = FRakisUIStyle::StepFade(Opacity, bSandWalking ? 1.f : 0.f, Dt, 0.2f, 0.6f);
}

int32 SRakisRhythmTicks::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	using namespace RakisTicksPrivate;

	const float Alpha = FRakisUIStyle::EaseOut(Opacity) * InWidgetStyle.GetColorAndOpacityTint().A;
	if (Alpha < 0.003f)
	{
		return LayerId;
	}

	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const float OriginX = (static_cast<float>(LocalSize.X) - Width) * 0.5f;
	const float BottomY = static_cast<float>(LocalSize.Y);
	const FLinearColor Color = FRakisUIStyle::WithAlpha(
		FMath::Lerp(FRakisUIStyle::Ochre(), FRakisUIStyle::ColdWhite(), Regularity), Alpha * 0.9f);

	// MakeBox — без массивов точек, ноль аллокаций.
	for (int32 Index = 0; Index < NumTicks; ++Index)
	{
		const float X = OriginX + Positions[Index] * Width - TickWidth * 0.5f;
		const float H = Heights[Index];
		FSlateDrawElement::MakeBox(OutDrawElements, LayerId,
			AllottedGeometry.ToPaintGeometry(FVector2f(TickWidth, H), FSlateLayoutTransform(FVector2f(X, BottomY - H))),
			FRakisUIStyle::WhiteBrush(), ESlateDrawEffect::None, Color);
	}
	return LayerId + 1;
}

FVector2D SRakisRhythmTicks::ComputeDesiredSize(float LayoutScaleMultiplier) const
{
	return FVector2D(RakisTicksPrivate::Width + 8.0, RakisTicksPrivate::Height);
}
