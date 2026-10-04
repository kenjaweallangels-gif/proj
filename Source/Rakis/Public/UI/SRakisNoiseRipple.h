#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

/**
 * Шумовая рябь: 3 тонкие концентрические дуги (~120°) внизу по центру.
 * Толщина/яркость = шум, дрожь + сдвиг в охристо-красный (#B5462C) и сужение дуг = угроза червя.
 * Гаснет, если игрок не на песке или шум < 0.05 дольше 2 с (docs/ui/ui_design.md §5.1).
 */
class RAKIS_API SRakisNoiseRipple : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisNoiseRipple) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Вызывается ARakisHUD с частотой опроса (30 Гц). */
	void SetValues(float InNoise01, float InThreat01, bool bInThreatActive, bool bInOnSand);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;

protected:
	virtual bool ComputeVolatility() const override { return true; }

private:
	// Входные значения
	float TargetNoise = 0.f;
	float Threat = 0.f;
	bool bThreatActive = false;
	bool bOnSand = false;

	// Сглаженные значения
	float Noise = 0.f;
	float ThreatSmoothed = 0.f;
	float Opacity = 0.f;
	float Time = 0.f;

	// Правила видимости
	float TimeSinceNoiseAbove = 100.f;
	float TimeSinceChange = 100.f;
	float LastMarkedNoise = 0.f;
	float LastMarkedThreat = 0.f;
};
