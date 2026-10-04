#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

/**
 * Засечки ритма: 6 крошечных вертикальных засечек под рябью.
 * Расстояния пропорциональны последним интервалам шагов; охра — неровно (хорошо), холодный белый — метроном.
 * Видны только в режиме походки по песку (docs/ui/ui_design.md §5.2).
 */
class RAKIS_API SRakisRhythmTicks : public SLeafWidget
{
public:
	static constexpr int32 NumTicks = 6;

	SLATE_BEGIN_ARGS(SRakisRhythmTicks) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Intervals — до 6 последних интервалов (сек). Копируются в фиксированный буфер. */
	void SetValues(bool bInSandWalking, float InRegularity01, const TArray<float>& InIntervals);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;

protected:
	virtual bool ComputeVolatility() const override { return true; }

private:
	bool bSandWalking = false;
	float TargetRegularity = 0.5f;
	float Regularity = 0.5f;
	float Opacity = 0.f;

	/** Нормированные позиции засечек 0..1 (целевые и сглаженные). */
	float TargetPositions[NumTicks] = {};
	float Positions[NumTicks] = {};
	/** Высота засечки 5..9 px — по отклонению интервала от среднего. */
	float TargetHeights[NumTicks] = {};
	float Heights[NumTicks] = {};
};
