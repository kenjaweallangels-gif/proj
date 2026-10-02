#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "UI/RakisUIStyle.h"

class STextBlock;
class SBox;

/**
 * Титр: тонкий шрифт с широкой разрядкой, fade-in / удержание / fade-out.
 * Один класс в трёх ролях: титр главы (нижняя треть, линия под текстом), надпись-лор (центр), концовка (центр, крупно).
 * Положение задаёт корень HUD через слот; здесь — только содержимое и анимация (docs/ui/ui_design.md §5.7).
 */
class RAKIS_API SRakisTitleCard : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisTitleCard)
		: _FontRole(ERakisFontRole::Title)
		, _FontSize(38.f)
		, _LetterSpacing(420)
		, _bShowRule(true)
		, _FadeIn(1.2f)
		, _FadeOut(1.6f)
		, _MaxWidth(1400.f)
		{}
		SLATE_ARGUMENT(ERakisFontRole, FontRole)
		SLATE_ARGUMENT(float, FontSize)
		SLATE_ARGUMENT(int32, LetterSpacing)
		SLATE_ARGUMENT(bool, bShowRule)
		SLATE_ARGUMENT(float, FadeIn)
		SLATE_ARGUMENT(float, FadeOut)
		SLATE_ARGUMENT(float, MaxWidth)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Показать текст: появление FadeIn, удержание HoldSeconds, угасание FadeOut. */
	void Show(const FText& InText, float HoldSeconds);
	void HideNow();
	bool IsShowing() const { return Hold > 0.f || Opacity > 0.f; }

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

private:
	TSharedPtr<STextBlock> Text;
	TSharedPtr<SBox> Rule;
	float FadeIn = 1.2f;
	float FadeOut = 1.6f;
	float Hold = 0.f;
	float Opacity = 0.f;
	bool bRising = false;
};
