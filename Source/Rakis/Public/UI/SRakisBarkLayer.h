#pragma once

#include "CoreMinimal.h"
#include "Fonts/SlateFontInfo.h"
#include "Widgets/SLeafWidget.h"
#include "Narrative/RakisDialogueSubsystem.h"

/**
 * Позиционный лай толпы: маленький тусклый текст над головой говорящего (docs/ui/ui_design.md §5.6).
 * Якорь (нормированные координаты экрана 0..1) обновляет ARakisHUD каждый кадр.
 */
class RAKIS_API SRakisBarkLayer : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisBarkLayer) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	void ShowBark(const FText& Line, float Duration);
	/** NormalizedPos — 0..1 по экрану; Distance01 — 0 (рядом) … 1 (на границе 8 м). */
	void SetAnchor(const FVector2f& NormalizedPos, float Distance01);
	void SetSizePreset(ERakisSubtitleSize InSize);
	void SetFrozen(bool bInFrozen) { bFrozen = bInFrozen; }
	bool IsShowing() const { return Remaining > 0.f || Opacity > 0.f; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override { return FVector2D(1.0, 1.0); }

protected:
	virtual bool ComputeVolatility() const override { return true; }

private:
	void Remeasure();

	FString LineString;
	FSlateFontInfo Font;
	FVector2f TextSize = FVector2f::ZeroVector;
	FVector2f Anchor = FVector2f(0.5f, 0.6f);
	float DistanceFade = 1.f;
	float Remaining = 0.f;
	float Opacity = 0.f;
	bool bFrozen = false;
};
