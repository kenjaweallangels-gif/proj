#include "UI/SRakisMoistureDrop.h"

#include "UI/RakisUIStyle.h"
#include "Rendering/DrawElements.h"

namespace RakisDropPrivate
{
	static constexpr float DropHeight = 18.f;
	static constexpr float DropWidth = 13.f;
	static constexpr float WidgetSize = 26.f;	// запас под кайму (×1.3)
	static constexpr float RimScale = 1.3f;
	static constexpr float FillStep = 1.f;
	static constexpr int32 OutlineSegments = 40;
	static constexpr float ShowBelow = 0.7f;
	static constexpr float AlwaysBelow = 0.25f;
	static constexpr float BucketSize = 0.05f;	// напоминание каждые 5 % ниже 70 %
	static constexpr float JumpThreshold = 0.03f;	// резкое изменение (питьё и т.п.)
}

void SRakisMoistureDrop::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
	BuildShape();
}

void SRakisMoistureDrop::BuildShape()
{
	using namespace RakisDropPrivate;

	// Капля: x = sin(t)·sin(t/2), y = cos(t); t ∈ [0, 2π]; кончик сверху (t = 0), круглое дно (t = π).
	constexpr int32 FineSamples = 720;
	float MaxX = 0.f;
	for (int32 I = 0; I <= FineSamples; ++I)
	{
		const float T = UE_TWO_PI * I / FineSamples;
		MaxX = FMath::Max(MaxX, FMath::Abs(FMath::Sin(T) * FMath::Sin(T * 0.5f)));
	}
	MaxX = FMath::Max(MaxX, KINDA_SMALL_NUMBER);

	auto ToLocal = [MaxX](float T) -> FVector2f
	{
		const float X = FMath::Sin(T) * FMath::Sin(T * 0.5f);
		const float Y = FMath::Cos(T);
		return FVector2f(X / MaxX * DropWidth * 0.5f, -Y * DropHeight * 0.5f);
	};

	UnitOutline.Reset(OutlineSegments + 1);
	for (int32 I = 0; I <= OutlineSegments; ++I)
	{
		UnitOutline.Add(ToLocal(UE_TWO_PI * I / OutlineSegments));
	}

	// Полуширина по строкам снизу вверх.
	const int32 NumRows = FMath::CeilToInt(DropHeight / FillStep);
	RowHalfWidths.Init(0.f, NumRows);
	for (int32 I = 0; I <= FineSamples; ++I)
	{
		const FVector2f P = ToLocal(UE_TWO_PI * I / FineSamples);
		const int32 Row = FMath::Clamp(FMath::FloorToInt((DropHeight * 0.5f - P.Y) / FillStep), 0, NumRows - 1);
		RowHalfWidths[Row] = FMath::Max(RowHalfWidths[Row], FMath::Abs(P.X));
	}
}

void SRakisMoistureDrop::SetValues(float InMoisture01, bool bInShade)
{
	using namespace RakisDropPrivate;
	const float NewValue = FMath::Clamp(InMoisture01, 0.f, 1.f);

	bool bChanged = false;
	if (!bHasValue)
	{
		bHasValue = true;
		LastMarkedMoisture = NewValue;
		Moisture = NewValue;
	}
	else
	{
		const int32 OldBucket = FMath::FloorToInt(LastMarkedMoisture / BucketSize);
		const int32 NewBucket = FMath::FloorToInt(NewValue / BucketSize);
		const bool bBucketCrossed = OldBucket != NewBucket && NewValue < ShowBelow;
		const bool bJump = FMath::Abs(NewValue - TargetMoisture) >= JumpThreshold;
		const bool bShadeFlip = bInShade != bShade;
		bChanged = bBucketCrossed || bJump || bShadeFlip;
		if (OldBucket != NewBucket || bJump)
		{
			LastMarkedMoisture = NewValue;
		}
	}
	if (bChanged)
	{
		TimeSinceChange = 0.f;
	}

	TargetMoisture = NewValue;
	bShade = bInShade;
}

void SRakisMoistureDrop::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	using namespace RakisDropPrivate;
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	Time += Dt;
	TimeSinceChange += Dt;
	Moisture = FMath::FInterpTo(Moisture, TargetMoisture, Dt, 4.f);

	const bool bWant = bHasValue && (TargetMoisture < AlwaysBelow || TimeSinceChange < FRakisUIStyle::AutoHideDelay);
	Opacity = FRakisUIStyle::StepFade(Opacity, bWant ? 1.f : 0.f, Dt, 0.3f, 0.8f);
	ShadeOpacity = FRakisUIStyle::StepFade(ShadeOpacity, bShade ? 1.f : 0.f, Dt, 0.4f, 0.4f);
}

int32 SRakisMoistureDrop::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	using namespace RakisDropPrivate;

	float Alpha = FRakisUIStyle::EaseOut(Opacity) * InWidgetStyle.GetColorAndOpacityTint().A;
	if (Alpha < 0.003f || UnitOutline.Num() < 2)
	{
		return LayerId;
	}
	// Критически мало воды — медленное «дыхание».
	if (TargetMoisture < AlwaysBelow)
	{
		Alpha *= 0.8f + 0.2f * FMath::Sin(Time * UE_TWO_PI * 0.5f);
	}

	const FVector2D LocalSize = AllottedGeometry.GetLocalSize();
	const FVector2f Center(static_cast<float>(LocalSize.X) * 0.5f, static_cast<float>(LocalSize.Y) * 0.5f);
	const FPaintGeometry PaintGeometry = AllottedGeometry.ToPaintGeometry();

	// 1) Заливка: зигзаг по строкам снизу вверх (одна полилиния).
	const int32 FillRows = FMath::Clamp(FMath::RoundToInt(Moisture * RowHalfWidths.Num()), 0, RowHalfWidths.Num());
	if (FillRows > 0)
	{
		TArray<FVector2f> Fill;
		Fill.Reserve(FillRows * 2);
		for (int32 Row = 0; Row < FillRows; ++Row)
		{
			const float Y = Center.Y + DropHeight * 0.5f - (Row + 0.5f) * FillStep;
			const float HalfWidth = FMath::Max(RowHalfWidths[Row] - 0.7f, 0.2f);
			const FVector2f Left(Center.X - HalfWidth, Y);
			const FVector2f Right(Center.X + HalfWidth, Y);
			if ((Row & 1) == 0)
			{
				Fill.Add(Left);
				Fill.Add(Right);
			}
			else
			{
				Fill.Add(Right);
				Fill.Add(Left);
			}
		}
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId, PaintGeometry, MoveTemp(Fill), ESlateDrawEffect::None,
			FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), Alpha * 0.85f), false, FillStep * 1.15f);
	}

	// 2) Контур.
	{
		TArray<FVector2f> Outline;
		Outline.Reserve(UnitOutline.Num());
		for (const FVector2f& P : UnitOutline)
		{
			Outline.Add(Center + P);
		}
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, PaintGeometry, MoveTemp(Outline), ESlateDrawEffect::None,
			FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), Alpha * 0.55f), true, 1.f);
	}

	// 3) Синяя кайма в тени.
	if (ShadeOpacity > 0.003f)
	{
		TArray<FVector2f> Rim;
		Rim.Reserve(UnitOutline.Num());
		for (const FVector2f& P : UnitOutline)
		{
			Rim.Add(Center + P * RimScale);
		}
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, PaintGeometry, MoveTemp(Rim), ESlateDrawEffect::None,
			FRakisUIStyle::WithAlpha(FRakisUIStyle::IbadBlue(), Alpha * ShadeOpacity * 0.65f), true, 1.f);
	}

	return LayerId + 2;
}

FVector2D SRakisMoistureDrop::ComputeDesiredSize(float LayoutScaleMultiplier) const
{
	return FVector2D(RakisDropPrivate::WidgetSize, RakisDropPrivate::WidgetSize);
}
