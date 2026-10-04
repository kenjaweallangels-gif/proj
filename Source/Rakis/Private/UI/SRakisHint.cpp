#include "UI/SRakisHint.h"

#include "UI/RakisUIStyle.h"
#include "Widgets/Text/STextBlock.h"

namespace RakisHintPrivate
{
	static constexpr float FadeIn = 0.5f;
	static constexpr float FadeOut = 0.9f;
}

void SRakisHint::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::HitTestInvisible);

	ChildSlot
	.HAlign(HAlign_Center)
	.VAlign(VAlign_Top)
	[
		SAssignNew(Text, STextBlock)
		.Font(FRakisUIStyle::GetFont(ERakisFontRole::Body, 17.f, 40, true))
		.ColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::WarmWhite(), 0.85f))
		.ShadowOffset(FVector2D(1.0, 1.5))
		.ShadowColorAndOpacity(FRakisUIStyle::WithAlpha(FRakisUIStyle::Ink(), 0.7f))
		.Justification(ETextJustify::Center)
	];
	SetRenderOpacity(0.f);
}

void SRakisHint::Show(const FText& InHint, float HoldSeconds)
{
	if (InHint.IsEmpty())
	{
		Hold = 0.f;
		return;
	}
	if (Text.IsValid())
	{
		Text->SetText(InHint);
	}
	Hold = HoldSeconds > 0.f ? HoldSeconds : FMath::Clamp(0.06f * InHint.ToString().Len() + 2.5f, 4.f, 8.f);
	bRising = true;
}

void SRakisHint::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	using namespace RakisHintPrivate;
	const float Dt = FMath::Min(InDeltaTime, 0.1f);
	if (bRising)
	{
		Opacity = FMath::Min(1.f, Opacity + Dt / FadeIn);
		bRising = Opacity < 1.f;
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
