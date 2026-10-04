#include "UI/RakisHUD.h"

#include "Rakis.h"
#include "UI/RakisPhotoCamera.h"
#include "UI/RakisUIStyle.h"
#include "UI/SRakisBarkLayer.h"
#include "UI/SRakisHint.h"
#include "UI/SRakisHUDRoot.h"
#include "UI/SRakisInteractPrompt.h"
#include "UI/SRakisMoistureDrop.h"
#include "UI/SRakisNoiseRipple.h"
#include "UI/SRakisPauseMenu.h"
#include "UI/SRakisPhotoMode.h"
#include "UI/SRakisRhythmTicks.h"
#include "UI/SRakisScreenFX.h"
#include "UI/SRakisSubtitles.h"
#include "UI/SRakisTitleCard.h"

#include "Narrative/RakisDialogueSubsystem.h"
#include "Narrative/RakisStoryDirector.h"

// API других ролей (контракт §2.2).
#include "Hydration/RakisHydrationComponent.h"
#include "Interaction/RakisInteractionComponent.h"
#include "Noise/RakisNoiseComponent.h"
#include "Noise/RakisSandWalkComponent.h"
#include "Player/RakisCharacter.h"
#include "Player/RakisPlayerController.h"
#include "World/RakisZoneSubsystem.h"
#include "Worm/RakisWorm.h"

#include "Camera/PlayerCameraManager.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/PlayerController.h"
#include "HAL/PlatformTime.h"
#include "Math/RotationMatrix.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Widgets/SWeakWidget.h"

#define RAKIS_LOC(RU, EN) (IsRussian() ? FText::FromString(TEXT(RU)) : FText::FromString(TEXT(EN)))

namespace RakisHUDPrivate
{
	static constexpr float PhotoTimeDilation = 0.0001f;	// минимум WorldSettings::MinGlobalTimeDilation
	static constexpr float BarkHeadOffsetCm = 180.f;
	static constexpr double EndFadeSeconds = 2.5;
	static constexpr float EndCardHold = 5.f;
	static constexpr double EndCardTotal = 1.2 + 5.0 + 1.6;
	static const FName GlobalPPTag(TEXT("Rakis.PP.Global"));

	static const TCHAR* SizeName(ERakisSubtitleSize Size)
	{
		switch (Size)
		{
		case ERakisSubtitleSize::S: return TEXT("S");
		case ERakisSubtitleSize::L: return TEXT("L");
		default: return TEXT("M");
		}
	}
}

ARakisHUD::ARakisHUD()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	// Меню паузы, конец демо и опрос значений работают и на паузе.
	PrimaryActorTick.bTickEvenWhenPaused = true;
	SetTickableWhenPaused(true);
}

ARakisHUD* ARakisHUD::Get(const UObject* WorldContextObject)
{
	const APlayerController* PC = UGameplayStatics::GetPlayerController(WorldContextObject, 0);
	return PC ? Cast<ARakisHUD>(PC->GetHUD()) : nullptr;
}

bool ARakisHUD::IsRussian() const
{
	const URakisDialogueSubsystem* Dialogue = BoundDialogue.Get();
	return Dialogue && Dialogue->GetLanguage() == ERakisLanguage::RU;
}

// ---------------------------------------------------------------------------------------------
// Жизненный цикл

void ARakisHUD::BeginPlay()
{
	Super::BeginPlay();

	UWorld* World = GetWorld();
	UGameViewportClient* Viewport = World ? World->GetGameViewport() : nullptr;
	if (!Viewport || !FSlateApplication::IsInitialized())
	{
		UE_LOG(LogRakis, Log, TEXT("RakisHUD: no game viewport (server/commandlet) — UI disabled"));
		return;
	}

	FRakisUIStyle::PreloadFonts();

	SAssignNew(Root, SRakisHUDRoot)
		.OnMenuAction(FRakisOnMenuAction::CreateUObject(this, &ARakisHUD::HandleMenuAction))
		.OnPhotoExitRequested(FSimpleDelegate::CreateUObject(this, &ARakisHUD::ExitPhotoMode));

	ViewportWidget = SNew(SWeakWidget).PossiblyNullContent(Root);
	Viewport->AddViewportWidgetContent(ViewportWidget.ToSharedRef(), 10);

	InputDetector = MakeShared<FRakisInputDeviceDetector>();
	FSlateApplication::Get().RegisterInputPreProcessor(StaticCastSharedPtr<IInputProcessor>(InputDetector));

	// Старт уровня: из чёрного.
	Root->Fade->SetFadeImmediate(1.f);
	PendingStartFadeAt = FPlatformTime::Seconds() + 0.3;

	BindDialogue();
	ApplySubtitleSettings();
	BindPlayerController();
	TryBindStoryDirector();
}

void ARakisHUD::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (bPhotoMode)
	{
		ExitPhotoMode();
	}

	UnbindDialogue();
	if (ARakisPlayerController* PC = BoundController.Get())
	{
		PC->OnPauseRequested.RemoveDynamic(this, &ARakisHUD::HandlePauseRequested);
		PC->OnPhotoModeRequested.RemoveDynamic(this, &ARakisHUD::HandlePhotoModeRequested);
	}
	if (URakisInteractionComponent* Interaction = BoundInteraction.Get())
	{
		Interaction->OnFocusChanged.RemoveDynamic(this, &ARakisHUD::HandleFocusChanged);
	}
	if (ARakisStoryDirector* Story = BoundStory.Get())
	{
		Story->OnTitleCard.RemoveDynamic(this, &ARakisHUD::HandleTitleCard);
		Story->OnHint.RemoveDynamic(this, &ARakisHUD::HandleHint);
	}

	if (InputDetector.IsValid() && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().UnregisterInputPreProcessor(StaticCastSharedPtr<IInputProcessor>(InputDetector));
	}
	InputDetector.Reset();

	if (ViewportWidget.IsValid())
	{
		UWorld* World = GetWorld();
		if (UGameViewportClient* Viewport = World ? World->GetGameViewport() : nullptr)
		{
			Viewport->RemoveViewportWidgetContent(ViewportWidget.ToSharedRef());
		}
	}
	ViewportWidget.Reset();
	Root.Reset();

	Super::EndPlay(EndPlayReason);
}

void ARakisHUD::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Root.IsValid())
	{
		return;
	}

	const double Now = FPlatformTime::Seconds();
	if (PendingStartFadeAt > 0.0 && Now >= PendingStartFadeAt)
	{
		PendingStartFadeAt = -1.0;
		FadeFromBlack(StartFadeSeconds);
	}

	if (Now >= NextPollTime)
	{
		NextPollTime = Now + 1.0 / FMath::Max(PollRateHz, 1.f);
		PollGameplay(Now);
	}

	UpdateBarkAnchor();
	UpdateEndSequence(Now);
}

// ---------------------------------------------------------------------------------------------
// Привязки

void ARakisHUD::BindDialogue()
{
	URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this);
	if (!Dialogue || BoundDialogue.Get() == Dialogue)
	{
		return;
	}
	BoundDialogue = Dialogue;
	Dialogue->OnSubtitle.AddUniqueDynamic(this, &ARakisHUD::HandleSubtitle);
	Dialogue->OnBarkSubtitle.AddUniqueDynamic(this, &ARakisHUD::HandleBarkSubtitle);
	Dialogue->OnLore.AddUniqueDynamic(this, &ARakisHUD::HandleLore);
	Dialogue->OnLanguageChanged.AddUniqueDynamic(this, &ARakisHUD::HandleLanguageChanged);
	Dialogue->OnSubtitleSettingsChanged.AddUniqueDynamic(this, &ARakisHUD::HandleSubtitleSettingsChanged);
}

void ARakisHUD::UnbindDialogue()
{
	// Подсистема GameInstance переживает уровень — обязательно отписываемся.
	if (URakisDialogueSubsystem* Dialogue = BoundDialogue.Get())
	{
		Dialogue->OnSubtitle.RemoveDynamic(this, &ARakisHUD::HandleSubtitle);
		Dialogue->OnBarkSubtitle.RemoveDynamic(this, &ARakisHUD::HandleBarkSubtitle);
		Dialogue->OnLore.RemoveDynamic(this, &ARakisHUD::HandleLore);
		Dialogue->OnLanguageChanged.RemoveDynamic(this, &ARakisHUD::HandleLanguageChanged);
		Dialogue->OnSubtitleSettingsChanged.RemoveDynamic(this, &ARakisHUD::HandleSubtitleSettingsChanged);
	}
	BoundDialogue.Reset();
}

void ARakisHUD::BindPlayerController()
{
	ARakisPlayerController* PC = Cast<ARakisPlayerController>(GetOwningPlayerController());
	if (!PC || BoundController.Get() == PC)
	{
		return;
	}
	BoundController = PC;
	PC->OnPauseRequested.AddUniqueDynamic(this, &ARakisHUD::HandlePauseRequested);
	PC->OnPhotoModeRequested.AddUniqueDynamic(this, &ARakisHUD::HandlePhotoModeRequested);
}

void ARakisHUD::BindCharacter(ARakisCharacter* NewCharacter)
{
	if (URakisInteractionComponent* Old = BoundInteraction.Get())
	{
		Old->OnFocusChanged.RemoveDynamic(this, &ARakisHUD::HandleFocusChanged);
	}
	BoundInteraction.Reset();
	BoundCharacter = NewCharacter;
	bFocusActive = false;

	if (NewCharacter)
	{
		if (URakisInteractionComponent* Interaction = NewCharacter->GetInteraction())
		{
			BoundInteraction = Interaction;
			Interaction->OnFocusChanged.AddUniqueDynamic(this, &ARakisHUD::HandleFocusChanged);
		}
	}
}

void ARakisHUD::TryBindStoryDirector()
{
	if (BoundStory.IsValid())
	{
		return;
	}
	if (ARakisStoryDirector* Story = ARakisStoryDirector::Find(this))
	{
		BoundStory = Story;
		Story->OnTitleCard.AddUniqueDynamic(this, &ARakisHUD::HandleTitleCard);
		Story->OnHint.AddUniqueDynamic(this, &ARakisHUD::HandleHint);
	}
}

ARakisWorm* ARakisHUD::FindWorm(double Now)
{
	if (ARakisWorm* Worm = CachedWorm.Get())
	{
		return Worm;
	}
	if (Now < NextWormSearchTime)
	{
		return nullptr;
	}
	NextWormSearchTime = Now + 2.0;
	if (UWorld* World = GetWorld())
	{
		for (TActorIterator<ARakisWorm> It(World); It; ++It)
		{
			CachedWorm = *It;
			return *It;
		}
	}
	return nullptr;
}

// ---------------------------------------------------------------------------------------------
// Опрос (30 Гц)

void ARakisHUD::PollGameplay(double Now)
{
	APlayerController* PC = GetOwningPlayerController();
	UWorld* World = GetWorld();
	if (!PC || !World || !Root.IsValid())
	{
		return;
	}

	BindPlayerController();
	BindDialogue();
	if (Now >= NextStoryBindTime)
	{
		NextStoryBindTime = Now + 1.0;
		TryBindStoryDirector();
	}

	ARakisCharacter* Character = Cast<ARakisCharacter>(PC->GetPawn());
	if (Character != BoundCharacter.Get())
	{
		BindCharacter(Character);
	}

	float Noise01 = 0.f;
	float Threat01 = 0.f;
	float Regularity = 0.f;
	bool bOnSand = false;
	bool bSandWalking = false;
	bool bThreatActive = false;
	TArray<float> Intervals;

	if (Character)
	{
		if (const URakisNoiseComponent* Noise = Character->GetNoise())
		{
			Noise01 = Noise->GetNoise01();
		}
		const ERakisSurface Surface = Character->GetCurrentSurface();
		bOnSand = Surface == ERakisSurface::Sand || Surface == ERakisSurface::PackedSand;

		if (const URakisSandWalkComponent* SandWalk = Character->GetSandWalk())
		{
			bSandWalking = SandWalk->IsSandWalking();
			Regularity = SandWalk->GetRhythmRegularity();
			if (bSandWalking)
			{
				Intervals = SandWalk->GetRecentIntervals();
			}
		}
		if (const URakisHydrationComponent* Hydration = Character->GetHydration())
		{
			Root->Drop->SetValues(Hydration->GetMoisture01(), Hydration->IsInShade());
		}
		// Страховка: фокус пропал без события.
		if (const URakisInteractionComponent* Interaction = Character->GetInteraction())
		{
			if (!Interaction->GetFocused())
			{
				bFocusActive = false;
			}
		}
	}
	else
	{
		bFocusActive = false;
	}

	if (const ARakisWorm* Worm = FindWorm(Now))
	{
		Threat01 = Worm->GetThreat01();
		const ERakisWormState State = Worm->GetState();
		bThreatActive = State == ERakisWormState::Listening || State == ERakisWormState::Approach || State == ERakisWormState::Surface;
	}

	bool bInterior = false;
	if (const URakisZoneSubsystem* Zones = World->GetSubsystem<URakisZoneSubsystem>())
	{
		bInterior = static_cast<uint8>(Zones->GetPlayerZone()) >= static_cast<uint8>(ERakisZone::B1_Airlock);
	}

	// Кат-сцена через ARakisCinematicTrigger / Sequencer выключает bShowHUD — считаем это кинорежимом.
	const bool bCinematicNow = bCinematicMode || !bShowHUD;
	const bool bMenuOrPhoto = IsPauseMenuOpen() || bPhotoMode;

	Root->Ripple->SetValues(Noise01, Threat01, bThreatActive, bOnSand && Character != nullptr);
	Root->Ticks->SetValues(bSandWalking && bOnSand, Regularity, Intervals);
	Root->Prompt->SetFocus(bFocusActive, FocusVerb);
	Root->Prompt->SetSuppressed(bCinematicNow || bMenuOrPhoto || bEndDemo);
	Root->Letterbox->SetLetterbox(bCinematicNow && !bEndDemo);
	Root->SetGameplayLayerVisible(!bInterior && !bCinematicNow && !bEndDemo);

	const bool bFrozen = UGameplayStatics::IsGamePaused(this) || bPhotoMode;
	Root->Subtitles->SetFrozen(bFrozen);
	Root->Barks->SetFrozen(bFrozen);
}

void ARakisHUD::UpdateBarkAnchor()
{
	AActor* Speaker = BarkSpeaker.Get();
	APlayerController* PC = GetOwningPlayerController();
	if (!Speaker || !PC || !Root.IsValid() || !Root->Barks->IsShowing())
	{
		return;
	}
	int32 SizeX = 0;
	int32 SizeY = 0;
	PC->GetViewportSize(SizeX, SizeY);
	if (SizeX <= 0 || SizeY <= 0)
	{
		return;
	}

	const FVector Head = Speaker->GetActorLocation() + FVector(0.f, 0.f, RakisHUDPrivate::BarkHeadOffsetCm);
	FVector2D Screen;
	FVector2f Normalized(0.5f, 0.7f);
	if (PC->ProjectWorldLocationToScreen(Head, Screen, false))
	{
		Normalized = FVector2f(static_cast<float>(Screen.X / SizeX), static_cast<float>(Screen.Y / SizeY));
	}
	else
	{
		// За спиной — прижимаем к краю со стороны говорящего.
		FVector ViewLocation;
		FRotator ViewRotation;
		PC->GetPlayerViewPoint(ViewLocation, ViewRotation);
		const float Side = static_cast<float>(FVector::DotProduct(FRotationMatrix(ViewRotation).GetUnitAxis(EAxis::Y), (Head - ViewLocation).GetSafeNormal()));
		Normalized = FVector2f(Side >= 0.f ? 0.9f : 0.1f, 0.7f);
	}

	float Distance01 = 1.f;
	if (const APawn* Pawn = PC->GetPawn())
	{
		Distance01 = static_cast<float>(FVector::Dist(Pawn->GetActorLocation(), Speaker->GetActorLocation())) / URakisDialogueSubsystem::BarkSubtitleRadius;
	}
	Root->Barks->SetAnchor(Normalized, Distance01);
}

// ---------------------------------------------------------------------------------------------
// Делегаты

void ARakisHUD::HandlePauseRequested()
{
	if (bPhotoMode)
	{
		ExitPhotoMode();
		return;
	}
	if (IsPauseMenuOpen())
	{
		if (!bEndDemo)
		{
			ClosePauseMenu();
		}
		return;
	}
	// В конце демо меню открывается само; до этого Esc игнорируем.
	if (bEndDemo && !bEndMenuOpened)
	{
		return;
	}
	OpenPauseMenu();
}

void ARakisHUD::HandlePhotoModeRequested()
{
	if (bPhotoMode)
	{
		ExitPhotoMode();
	}
	else
	{
		EnterPhotoMode();
	}
}

void ARakisHUD::HandleFocusChanged(AActor* Actor, FText Verb)
{
	bFocusActive = Actor != nullptr;
	FocusVerb = Verb;
	if (Root.IsValid())
	{
		Root->Prompt->SetFocus(bFocusActive, FocusVerb);
	}
}

void ARakisHUD::HandleSubtitle(FText Speaker, FText Line, float Duration)
{
	if (Root.IsValid())
	{
		Root->Subtitles->ShowLine(Speaker, Line, Duration);
	}
}

void ARakisHUD::HandleBarkSubtitle(FText Line, float Duration, AActor* Speaker)
{
	if (!Root.IsValid())
	{
		return;
	}
	BarkSpeaker = Speaker;
	Root->Barks->ShowBark(Line, Duration);
	UpdateBarkAnchor();
}

void ARakisHUD::HandleLore(FText LoreText, float Duration)
{
	ShowInscription(LoreText, Duration);
}

void ARakisHUD::HandleTitleCard(FText Title, float Duration)
{
	ShowTitleCard(Title, Duration);
}

void ARakisHUD::HandleHint(FText InHint)
{
	ShowHint(InHint, 0.f);
}

void ARakisHUD::HandleLanguageChanged(ERakisLanguage NewLanguage)
{
	RefreshMenuTexts();
}

void ARakisHUD::HandleSubtitleSettingsChanged()
{
	ApplySubtitleSettings();
	RefreshMenuTexts();
}

void ARakisHUD::ApplySubtitleSettings()
{
	const URakisDialogueSubsystem* Dialogue = BoundDialogue.Get();
	if (!Root.IsValid() || !Dialogue)
	{
		return;
	}
	Root->Subtitles->SetSizePreset(Dialogue->GetSubtitleSize());
	Root->Subtitles->SetBackgroundPlate(Dialogue->GetSubtitleBackground());
	Root->Barks->SetSizePreset(Dialogue->GetSubtitleSize());
}

// ---------------------------------------------------------------------------------------------
// Публичное API

void ARakisHUD::SetCinematicMode(bool bEnable)
{
	bCinematicMode = bEnable;
	if (bEnable && bPhotoMode)
	{
		ExitPhotoMode();
	}
	if (Root.IsValid())
	{
		Root->Letterbox->SetLetterbox(bEnable || !bShowHUD);
		Root->Prompt->SetSuppressed(bEnable);
		Root->SetGameplayLayerVisible(!bEnable);
	}
}

void ARakisHUD::FadeToBlack(float Seconds)
{
	if (Root.IsValid())
	{
		Root->Fade->FadeTo(1.f, Seconds);
	}
}

void ARakisHUD::FadeFromBlack(float Seconds)
{
	if (Root.IsValid())
	{
		Root->Fade->FadeTo(0.f, Seconds);
	}
}

void ARakisHUD::ShowTitleCard(const FText& Title, float HoldSeconds)
{
	if (Root.IsValid() && !Title.IsEmpty())
	{
		Root->TitleCard->Show(Title, HoldSeconds);
	}
}

void ARakisHUD::ShowCutCard(const FText& InText, float HoldSeconds)
{
	if (Root.IsValid() && Root->CutCard.IsValid() && !InText.IsEmpty())
	{
		Root->CutCard->Show(InText, HoldSeconds);
	}
}

bool ARakisHUD::IsScreenFaded() const
{
	return Root.IsValid() && Root->Fade.IsValid() && (Root->Fade->GetFadeAlpha() > 0.02f || Root->Fade->IsFading());
}

void ARakisHUD::ShowHint(const FText& InHint, float HoldSeconds)
{
	if (Root.IsValid())
	{
		Root->Hint->Show(InHint, HoldSeconds);
	}
}

void ARakisHUD::ShowInscription(const FText& InText, float HoldSeconds)
{
	if (Root.IsValid() && !InText.IsEmpty())
	{
		Root->Inscription->Show(InText, HoldSeconds);
	}
}

void ARakisHUD::ShowEndCard()
{
	if (bEndDemo || !Root.IsValid())
	{
		return;
	}
	if (bPhotoMode)
	{
		ExitPhotoMode();
	}
	bEndDemo = true;
	bEndCardShown = false;
	bEndMenuOpened = false;
	EndSequenceStart = FPlatformTime::Seconds();
	FadeToBlack(static_cast<float>(RakisHUDPrivate::EndFadeSeconds));
}

void ARakisHUD::UpdateEndSequence(double Now)
{
	using namespace RakisHUDPrivate;
	if (!bEndDemo || !Root.IsValid())
	{
		return;
	}
	const double T = Now - EndSequenceStart;
	if (!bEndCardShown && T >= EndFadeSeconds + 0.1)
	{
		bEndCardShown = true;
		Root->EndCard->Show(RAKIS_LOC("Конец демо", "End of demo"), EndCardHold);
	}
	if (!bEndMenuOpened && T >= EndFadeSeconds + 0.1 + EndCardTotal)
	{
		bEndMenuOpened = true;
		OpenPauseMenu();
	}
}

// ---------------------------------------------------------------------------------------------
// Меню паузы

bool ARakisHUD::IsPauseMenuOpen() const
{
	return Root.IsValid() && Root->PauseMenu.IsValid() && Root->PauseMenu->IsOpen();
}

void ARakisHUD::BuildMenu(TArray<FRakisMenuEntry>& OutEntries, FText& OutCaption, FText& OutLegendKeyboard, FText& OutLegendGamepad) const
{
	const URakisDialogueSubsystem* Dialogue = BoundDialogue.Get();
	const bool bRU = IsRussian();
	const ERakisSubtitleSize Size = Dialogue ? Dialogue->GetSubtitleSize() : ERakisSubtitleSize::M;
	const bool bPlate = Dialogue && Dialogue->GetSubtitleBackground();

	auto Add = [&OutEntries](ERakisMenuAction Action, const FText& Label)
	{
		FRakisMenuEntry Entry;
		Entry.Action = Action;
		Entry.Label = Label;
		OutEntries.Add(Entry);
	};

	const FText LanguageLabel = bRU ? FText::FromString(TEXT("Язык: Русский")) : FText::FromString(TEXT("Language: English"));
	const FString SubtitleValue = FString(RakisHUDPrivate::SizeName(Size)) + (bPlate ? (bRU ? TEXT(" · подложка") : TEXT(" · background")) : TEXT(""));
	const FText SubtitleLabel = FText::FromString((bRU ? FString(TEXT("Субтитры: ")) : FString(TEXT("Subtitles: "))) + SubtitleValue);

	OutEntries.Reset();
	if (bEndDemo)
	{
		OutCaption = RAKIS_LOC("КОНЕЦ ДЕМО", "END OF DEMO");
		Add(ERakisMenuAction::Restart, RAKIS_LOC("Начать заново", "Restart"));
		Add(ERakisMenuAction::Language, LanguageLabel);
		Add(ERakisMenuAction::Subtitles, SubtitleLabel);
		Add(ERakisMenuAction::Quit, RAKIS_LOC("Выход", "Quit"));
		OutLegendKeyboard = RAKIS_LOC("↑↓ выбор  ·  Enter выбрать  ·  ←→ изменить", "↑↓ select  ·  Enter confirm  ·  ←→ change");
		OutLegendGamepad = RAKIS_LOC("D-pad выбор  ·  A выбрать  ·  ←→ изменить", "D-pad select  ·  A confirm  ·  ←→ change");
	}
	else
	{
		OutCaption = RAKIS_LOC("ПАУЗА", "PAUSED");
		Add(ERakisMenuAction::Resume, RAKIS_LOC("Продолжить", "Resume"));
		Add(ERakisMenuAction::PhotoMode, RAKIS_LOC("Фоторежим", "Photo mode"));
		Add(ERakisMenuAction::Language, LanguageLabel);
		Add(ERakisMenuAction::Subtitles, SubtitleLabel);
		Add(ERakisMenuAction::Quit, RAKIS_LOC("Выход", "Quit"));
		OutLegendKeyboard = RAKIS_LOC("↑↓ выбор  ·  Enter выбрать  ·  ←→ изменить  ·  Esc назад", "↑↓ select  ·  Enter confirm  ·  ←→ change  ·  Esc back");
		OutLegendGamepad = RAKIS_LOC("D-pad выбор  ·  A выбрать  ·  ←→ изменить  ·  B назад", "D-pad select  ·  A confirm  ·  ←→ change  ·  B back");
	}
}

void ARakisHUD::OpenPauseMenu()
{
	if (!Root.IsValid() || bPhotoMode || IsPauseMenuOpen())
	{
		return;
	}
	APlayerController* PC = GetOwningPlayerController();
	if (!PC)
	{
		return;
	}

	TArray<FRakisMenuEntry> Entries;
	FText Caption, LegendKeyboard, LegendGamepad;
	BuildMenu(Entries, Caption, LegendKeyboard, LegendGamepad);

	bPausedByMenu = UGameplayStatics::SetGamePaused(this, true);
	Root->PauseMenu->Open(Caption, Entries, !bEndDemo, LegendKeyboard, LegendGamepad);
	SetUIInputMode(true, Root->PauseMenu, true);
}

void ARakisHUD::ClosePauseMenu()
{
	if (!IsPauseMenuOpen())
	{
		return;
	}
	Root->PauseMenu->Close();
	if (bPausedByMenu)
	{
		UGameplayStatics::SetGamePaused(this, false);
		bPausedByMenu = false;
	}
	SetUIInputMode(false, nullptr, false);
}

void ARakisHUD::RefreshMenuTexts()
{
	if (!Root.IsValid())
	{
		return;
	}
	if (IsPauseMenuOpen())
	{
		TArray<FRakisMenuEntry> Entries;
		FText Caption, LegendKeyboard, LegendGamepad;
		BuildMenu(Entries, Caption, LegendKeyboard, LegendGamepad);
		Root->PauseMenu->UpdateEntries(Caption, Entries, LegendKeyboard, LegendGamepad);
	}
	if (bPhotoMode)
	{
		Root->PhotoMode->SetTexts(BuildPhotoTexts());
	}
}

void ARakisHUD::HandleMenuAction(ERakisMenuAction Action, int32 Direction)
{
	URakisDialogueSubsystem* Dialogue = BoundDialogue.Get();
	switch (Action)
	{
	case ERakisMenuAction::Resume:
		ClosePauseMenu();
		break;

	case ERakisMenuAction::PhotoMode:
		ClosePauseMenu();
		EnterPhotoMode();
		break;

	case ERakisMenuAction::Language:
		if (Dialogue)
		{
			// Два языка — любое направление переключает.
			Dialogue->SetLanguage(Dialogue->GetLanguage() == ERakisLanguage::RU ? ERakisLanguage::EN : ERakisLanguage::RU);
		}
		break;

	case ERakisMenuAction::Subtitles:
		if (Dialogue)
		{
			// Цикл из 6 состояний: S, M, L, S·подложка, M·подложка, L·подложка.
			const int32 Current = static_cast<int32>(Dialogue->GetSubtitleSize()) + (Dialogue->GetSubtitleBackground() ? 3 : 0);
			const int32 Step = Direction < 0 ? -1 : 1;
			const int32 Next = ((Current + Step) % 6 + 6) % 6;
			Dialogue->SetSubtitleSize(static_cast<ERakisSubtitleSize>(Next % 3));
			Dialogue->SetSubtitleBackground(Next >= 3);
		}
		break;

	case ERakisMenuAction::Restart:
	{
		ClosePauseMenu();
		UGameplayStatics::SetGamePaused(this, false);
		if (Dialogue)
		{
			Dialogue->StopAll();
		}
		const FString LevelName = UGameplayStatics::GetCurrentLevelName(this, true);
		UGameplayStatics::OpenLevel(this, FName(*LevelName));
		break;
	}

	case ERakisMenuAction::Quit:
		UKismetSystemLibrary::QuitGame(this, GetOwningPlayerController(), EQuitPreference::Quit, false);
		break;

	default:
		break;
	}
}

void ARakisHUD::SetUIInputMode(bool bUIOnly, const TSharedPtr<SWidget>& FocusWidget, bool bShowCursor)
{
	APlayerController* PC = GetOwningPlayerController();
	if (!PC)
	{
		return;
	}
	if (bUIOnly)
	{
		FInputModeUIOnly Mode;
		Mode.SetWidgetToFocus(FocusWidget);
		Mode.SetLockMouseToViewportBehavior(bShowCursor ? EMouseLockMode::DoNotLock : EMouseLockMode::LockAlways);
		PC->SetInputMode(Mode);
	}
	else
	{
		PC->SetInputMode(FInputModeGameOnly());
		if (FSlateApplication::IsInitialized())
		{
			FSlateApplication::Get().SetAllUserFocusToGameViewport();
		}
	}
	PC->bShowMouseCursor = bShowCursor;
}

// ---------------------------------------------------------------------------------------------
// Фоторежим

FRakisPhotoModeTexts ARakisHUD::BuildPhotoTexts() const
{
	FRakisPhotoModeTexts Texts;
	Texts.LegendKeyboard = RAKIS_LOC(
		"WASD движение  ·  Q/E вниз/вверх  ·  Shift быстрее  ·  ПКМ + мышь обзор  ·  колесо, ↑↓ FOV  ·  R/F фокус  ·  T/G диафрагма  ·  [ ] экспозиция  ·  Z/C крен  ·  Backspace сброс  ·  H скрыть  ·  Esc выход",
		"WASD move  ·  Q/E down/up  ·  Shift faster  ·  RMB + mouse look  ·  wheel, ↑↓ FOV  ·  R/F focus  ·  T/G aperture  ·  [ ] exposure  ·  Z/C roll  ·  Backspace reset  ·  H hide  ·  Esc exit");
	Texts.LegendGamepad = RAKIS_LOC(
		"ЛС движение  ·  LT/RT вниз/вверх  ·  ПС обзор  ·  D-pad ↑↓ FOV, ←→ крен  ·  LB/RB фокус  ·  A + LB/RB диафрагма  ·  X/Y экспозиция  ·  R3 сброс  ·  View скрыть  ·  B выход",
		"LS move  ·  LT/RT down/up  ·  RS look  ·  D-pad ↑↓ FOV, ←→ roll  ·  LB/RB focus  ·  A + LB/RB aperture  ·  X/Y exposure  ·  R3 reset  ·  View hide  ·  B exit");
	Texts.FocusOff = RAKIS_LOC("выкл", "off");
	Texts.FocusLabel = RAKIS_LOC("фокус", "focus");
	Texts.RollLabel = RAKIS_LOC("крен", "roll");
	Texts.Meters = RAKIS_LOC("м", "m");
	return Texts;
}

float ARakisHUD::ReadGlobalExposureBias() const
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return 0.f;
	}
	for (TActorIterator<APostProcessVolume> It(World); It; ++It)
	{
		if (It->ActorHasTag(RakisHUDPrivate::GlobalPPTag) && It->Settings.bOverride_AutoExposureBias)
		{
			return It->Settings.AutoExposureBias;
		}
	}
	return 0.f;
}

void ARakisHUD::EnterPhotoMode()
{
	// Нечего снимать: кат-сцена, конец демо, затемнение/склейка-эллипсис.
	if (bPhotoMode || bCinematicMode || !bShowHUD || bEndDemo || !Root.IsValid() || IsScreenFaded())
	{
		return;
	}
	APlayerController* PC = GetOwningPlayerController();
	UWorld* World = GetWorld();
	if (!PC || !World)
	{
		return;
	}
	if (IsPauseMenuOpen())
	{
		ClosePauseMenu();
	}

	FVector ViewLocation;
	FRotator ViewRotation;
	PC->GetPlayerViewPoint(ViewLocation, ViewRotation);
	const float Fov = PC->PlayerCameraManager ? PC->PlayerCameraManager->GetFOVAngle() : 70.f;
	const APawn* Pawn = PC->GetPawn();
	const FVector Anchor = Pawn ? Pawn->GetPawnViewLocation() : ViewLocation;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;
	PhotoCamera = World->SpawnActor<ARakisPhotoCamera>(ARakisPhotoCamera::StaticClass(), ViewLocation, ViewRotation, Params);
	if (!PhotoCamera)
	{
		UE_LOG(LogRakis, Warning, TEXT("RakisHUD: failed to spawn photo camera"));
		return;
	}
	PhotoCamera->SetBaseExposureBias(ReadGlobalExposureBias());

	// Время «замирает», но рендер, пост и камера продолжают обновляться.
	SavedTimeDilation = UGameplayStatics::GetGlobalTimeDilation(this);
	UGameplayStatics::SetGlobalTimeDilation(this, RakisHUDPrivate::PhotoTimeDilation);

	PC->SetViewTargetWithBlend(PhotoCamera, 0.f);
	if (ARakisCharacter* Character = Cast<ARakisCharacter>(PC->GetPawn()))
	{
		Character->SetInputLocked(true);
	}

	bPhotoMode = true;
	Root->SetHudHidden(true);
	Root->PhotoMode->Activate(PhotoCamera, ViewLocation, Anchor, ViewRotation, Fov, BuildPhotoTexts());
	SetUIInputMode(true, Root->PhotoMode, false);
}

void ARakisHUD::ExitPhotoMode()
{
	if (!bPhotoMode)
	{
		return;
	}
	bPhotoMode = false;

	if (Root.IsValid())
	{
		Root->PhotoMode->Deactivate();
		Root->SetHudHidden(false);
	}

	UGameplayStatics::SetGlobalTimeDilation(this, SavedTimeDilation > KINDA_SMALL_NUMBER ? SavedTimeDilation : 1.f);

	if (APlayerController* PC = GetOwningPlayerController())
	{
		if (APawn* Pawn = PC->GetPawn())
		{
			PC->SetViewTargetWithBlend(Pawn, 0.f);
		}
		if (ARakisCharacter* Character = Cast<ARakisCharacter>(PC->GetPawn()))
		{
			Character->SetInputLocked(false);
		}
	}
	SetUIInputMode(false, nullptr, false);

	if (PhotoCamera)
	{
		PhotoCamera->Destroy();
		PhotoCamera = nullptr;
	}
}

#undef RAKIS_LOC
