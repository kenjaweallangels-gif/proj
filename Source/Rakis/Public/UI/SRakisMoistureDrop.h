#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"

/**
 * Капля влаги 18 px: векторный контур (MakeLines), заливка снизу = влага (зигзаг-линия),
 * синяя кайма ибад (#6E9BC4) в тени. Появляется при влаге < 0.7 и недавнем изменении (docs/ui/ui_design.md §5.3).
 */
class RAKIS_API SRakisMoistureDrop : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisMoistureDrop) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	void SetValues(float InMoisture01, bool bInShade);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override;

protected:
	virtual bool ComputeVolatility() const override { return true; }

private:
	void BuildShape();

	/** Контур капли в локальных единицах (единичный, центр (0,0)), считается один раз. */
	TArray<FVector2f> UnitOutline;
	/** Полуширина капли по строкам заливки (снизу вверх), шаг FillStep. */
	TArray<float> RowHalfWidths;

	float TargetMoisture = 1.f;
	float Moisture = 1.f;
	bool bShade = false;
	bool bHasValue = false;

	float Opacity = 0.f;
	float ShadeOpacity = 0.f;
	float TimeSinceChange = 100.f;
	float LastMarkedMoisture = 1.f;
	float Time = 0.f;
};
