#pragma once

#include "CoreMinimal.h"
#include "Fonts/SlateFontInfo.h"
#include "Widgets/SLeafWidget.h"

/**
 * Подсказка взаимодействия: точка 2 px в центре экрана + глиф клавиши (E / X) + один глагол справа от центра.
 * Виджет растянут на весь экран (docs/ui/ui_design.md §5.4).
 */
class RAKIS_API SRakisInteractPrompt : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisInteractPrompt) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** bHasFocus = есть актор в фокусе; Verb — локализованный глагол (может быть пустым). */
	void SetFocus(bool bHasFocus, const FText& Verb);
	/** Внешнее подавление (кинорежим, пауза). */
	void SetSuppressed(bool bInSuppressed) { bSuppressed = bInSuppressed; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float LayoutScaleMultiplier) const override { return FVector2D(1.0, 1.0); }

protected:
	virtual bool ComputeVolatility() const override { return true; }

private:
	void RefreshMeasurements();

	bool bFocus = false;
	bool bSuppressed = false;
	bool bGamepadShown = false;
	float Opacity = 0.f;

	FString VerbString;
	FString KeyString;
	FSlateFontInfo VerbFont;
	FSlateFontInfo KeyFont;
	FVector2f VerbSize = FVector2f::ZeroVector;
	FVector2f KeySize = FVector2f::ZeroVector;
};
