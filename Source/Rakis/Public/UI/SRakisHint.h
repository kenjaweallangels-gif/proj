#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"

class STextBlock;

/** Однострочная подсказка сверху по центру, сама гаснет (docs/ui/ui_design.md §5.8). */
class RAKIS_API SRakisHint : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisHint) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** HoldSeconds <= 0 → авто: clamp(0.06 с/символ + 2.5, 4, 8). */
	void Show(const FText& InHint, float HoldSeconds = 0.f);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

private:
	TSharedPtr<STextBlock> Text;
	float Hold = 0.f;
	float Opacity = 0.f;
	bool bRising = false;
};
