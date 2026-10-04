#include "UI/SRakisTitleCard.h"

#include "Widgets/Images/SImage.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"

void SRakisTitleCard::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);
	FadeIn = FMath::Max(InArgs._FadeIn, 0.01f);
	FadeOut = FMath::Max(InArgs._FadeOut, 0.01f);

	ChildSlot
	.HAlign(HAlign_Center)
	.VAlign(VAlign_Center)
	[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot()
		.AutoHeight()
		.HAlign(HAlign_Center)
		[
			SAssignNew(Text, STextBlock)
			.Font(FRakisUIStyle::GetFont(InArgs._FontRole, InArgs._FontSize, InArgs._LetterSpacing, true))
			.ColorAndOpacity(FRakisUIStyle::WarmWhite())
			.ShadowOffset(FVector2D(1.0, 1.5))
			.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.6f))
			.Justification(ETextJustify::Center)
			.WrapTextAt(InArgs._MaxWidth)
		]
		+ SVerticalBox::Slot()
		.AutoHeight()
		.HAlign(HAlign_Center)
		.Padding(0.f, 14.f, 0.f, 0.f)
		[
			SAssignNew(Rule, SBox)
			.WidthOverride(140.f)
			.HeightOverride(1.f)
			.Visibility(InArgs._bShowRule ? EVisibility::HitTestInvisible : EVisibility::Collapsed)
			[
				SNew(SImage)
				.Image(FRakisUIStyle::WhiteBrush())
				.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ochre(), 0.7f))
			]
		]
	];

	SetRenderOpacity(0.f);
}

void SRakisTitleCard::Show(const FText& InText, float HoldSeconds)
{
	if (Text.IsValid())
	{
		Text->SetText(InText);
	}
	Hold = FMath::Max(HoldSeconds, 0.5f);
	bRising = true;
}

void SRakisTitleCard::HideNow()
{
	Hold = 0.f;
	bRising = false;
	Opacity = 0.f;
	SetRenderOpacity(0.f);
}

void SRakisTitleCard::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	if (bRising)
	{
		Opacity = FMath::Min(1.f, Opacity + Dt / FadeIn);
		if (Opacity >= 1.f)
		{
			bRising = false;
		}
	}
	else if (Hold > 0.f)
	{
		Hold = FMath::Max(0.f, Hold - Dt);
	}
	else
	{
		Opacity = FMath::Max(0.f, Opacity - Dt / FadeOut);
	}
	SetRenderOpacity(FRakisUIStyle::EaseOut(Opacity));
}
