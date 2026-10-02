#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

/**
 * Экранные эффекты UI: затемнение (fade to/from black) и леттербокс 2.35:1 для кат-сцен
 * (docs/ui/ui_design.md §5.9). Пыль/виньетка от червя — пост-материал, не UI.
 */
class RAKIS_API SRakisScreenFX : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisScreenFX) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Плавно к целевой непрозрачности чёрного за Seconds (реальное время). */
	void FadeTo(float TargetAlpha, float Seconds);
	void SetFadeImmediate(float Alpha);
	float GetFadeAlpha() const { return FadeAlpha; }
	bool IsFading() const { return !FMath::IsNearlyEqual(FadeAlpha, FadeTarget); }

	void SetLetterbox(bool bEnable) { bLetterbox = bEnable; }
	bool IsLetterboxActive() const { return bLetterbox; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override { return FVector2D(1.0, 1.0); }

protected:
	virtual bool ComputeVolatility() const override { return true; }

private:
	float FadeAlpha = 0.f;
	float FadeTarget = 0.f;
	float FadeSpeed = 1.f;	// единиц альфы в секунду

	bool bLetterbox = false;
	float Letterbox01 = 0.f;
};
