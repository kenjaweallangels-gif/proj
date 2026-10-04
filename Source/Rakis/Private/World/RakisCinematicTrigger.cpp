#include "World/RakisCinematicTrigger.h"

#include "Rakis.h"
#include "Player/RakisCharacter.h"
#include "Worm/RakisWorm.h"

#include "Components/BoxComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "LevelSequence.h"
#include "LevelSequenceActor.h"
#include "LevelSequencePlayer.h"
#include "MovieSceneSequencePlaybackSettings.h"
#include "TimerManager.h"

ARakisCinematicTrigger::ARakisCinematicTrigger()
{
	PrimaryActorTick.bCanEverTick = false;

	TriggerBox = CreateDefaultSubobject<UBoxComponent>(TEXT("TriggerBox"));
	TriggerBox->SetBoxExtent(FVector(400.f, 400.f, 300.f));
	TriggerBox->SetCollisionProfileName(UCollisionProfile::CustomCollisionProfileName);
	TriggerBox->SetCollisionObjectType(ECC_WorldDynamic);
	TriggerBox->SetCollisionResponseToAllChannels(ECR_Ignore);
	TriggerBox->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	TriggerBox->SetGenerateOverlapEvents(true);
	TriggerBox->SetHiddenInGame(true);
	RootComponent = TriggerBox;
}

void ARakisCinematicTrigger::BeginPlay()
{
	Super::BeginPlay();

	if (!bAutoPlayOnOverlap && TriggerBox)
	{
		TriggerBox->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	}
}

void ARakisCinematicTrigger::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(FallbackTimer);
	}
	if (bPlaying)
	{
		// Не оставляем игрока заблокированным, если актор выгрузился посреди кат-сцены.
		SetPlayerCinematicMode(false);
		bPlaying = false;
	}
	if (SequencePlayer)
	{
		SequencePlayer->OnFinished.RemoveDynamic(this, &ARakisCinematicTrigger::HandleSequenceFinished);
	}
	if (SequenceActor)
	{
		SequenceActor->Destroy();
		SequenceActor = nullptr;
	}
	Super::EndPlay(EndPlayReason);
}

void ARakisCinematicTrigger::NotifyActorBeginOverlap(AActor* OtherActor)
{
	Super::NotifyActorBeginOverlap(OtherActor);

	if (!bAutoPlayOnOverlap)
	{
		return;
	}
	const APawn* Pawn = Cast<APawn>(OtherActor);
	if (Pawn && Pawn->IsPlayerControlled() && Pawn->IsLocallyControlled())
	{
		Play();
	}
}

void ARakisCinematicTrigger::Play()
{
	if (bPlaying || (bPlayOnce && bHasPlayed))
	{
		return;
	}
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	bPlaying = true;
	bHasPlayed = true;

	SetPlayerCinematicMode(true);

	ULevelSequence* LoadedSequence = Sequence.IsNull() ? nullptr : Sequence.LoadSynchronous();
	if (LoadedSequence)
	{
		FMovieSceneSequencePlaybackSettings Settings;
		Settings.bHideHud = bHideHUD;
		Settings.bDisableMovementInput = bLockInput;
		Settings.bDisableLookAtInput = bLockInput;

		ALevelSequenceActor* OutActor = nullptr;
		SequencePlayer = ULevelSequencePlayer::CreateLevelSequencePlayer(this, LoadedSequence, Settings, OutActor);
		SequenceActor = OutActor;
		if (SequencePlayer)
		{
			SequencePlayer->OnFinished.AddUniqueDynamic(this, &ARakisCinematicTrigger::HandleSequenceFinished);
			SequencePlayer->Play();
			UE_LOG(LogRakis, Log, TEXT("Cinematic: %s"), *LoadedSequence->GetName());
			return;
		}
		UE_LOG(LogRakis, Warning, TEXT("Cinematic: не удалось создать плеер для %s — фоллбек."), *LoadedSequence->GetName());
	}
	else
	{
		UE_LOG(LogRakis, Warning, TEXT("Cinematic: последовательность '%s' отсутствует — фоллбек %.1f с."), *Sequence.ToString(), FallbackDuration);
	}

	// --- Фоллбек для блокаута ---
	RunFallbackWorm();
	if (FallbackDuration > UE_KINDA_SMALL_NUMBER)
	{
		World->GetTimerManager().SetTimer(FallbackTimer, this, &ARakisCinematicTrigger::Finish, FallbackDuration, false);
	}
	else
	{
		Finish();
	}
}

void ARakisCinematicTrigger::RunFallbackWorm()
{
	if (!bFallbackForceWormSurface || WormRevealTag.IsNone())
	{
		return;
	}
	UWorld* World = GetWorld();

	ARakisWorm* Worm = nullptr;
	for (TActorIterator<ARakisWorm> It(World); It; ++It)
	{
		if (IsValid(*It))
		{
			Worm = *It;
			break;
		}
	}
	if (!Worm)
	{
		return;
	}

	const AActor* RevealPoint = nullptr;
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		if (It->ActorHasTag(WormRevealTag))
		{
			RevealPoint = *It;
			break;
		}
	}
	if (!RevealPoint)
	{
		UE_LOG(LogRakis, Warning, TEXT("Cinematic: точка с тегом %s не найдена — червь не вызван."), *WormRevealTag.ToString());
		return;
	}

	// Голова смотрит на игрока (если есть), иначе — по ориентации точки.
	const FVector Location = RevealPoint->GetActorLocation();
	FRotator Facing = RevealPoint->GetActorRotation();
	if (const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		FVector ToPlayer = Player->GetActorLocation() - Location;
		ToPlayer.Z = 0.f;
		if (!ToPlayer.IsNearlyZero())
		{
			Facing = ToPlayer.Rotation();
		}
	}
	Worm->ForceSurface(Location, Facing);
}

void ARakisCinematicTrigger::HandleSequenceFinished()
{
	Finish();
}

void ARakisCinematicTrigger::Stop()
{
	if (!bPlaying)
	{
		return;
	}
	if (SequencePlayer && SequencePlayer->IsPlaying())
	{
		// Stop() сам вызовет OnFinished → Finish().
		SequencePlayer->Stop();
		if (!bPlaying)
		{
			return;
		}
	}
	Finish();
}

void ARakisCinematicTrigger::Finish()
{
	if (!bPlaying)
	{
		return;
	}
	bPlaying = false;

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(FallbackTimer);
	}
	if (SequencePlayer)
	{
		SequencePlayer->OnFinished.RemoveDynamic(this, &ARakisCinematicTrigger::HandleSequenceFinished);
		SequencePlayer = nullptr;
	}
	if (SequenceActor)
	{
		SequenceActor->Destroy();
		SequenceActor = nullptr;
	}

	SetPlayerCinematicMode(false);
	OnFinished.Broadcast();

	if (bDestroyOnFinish)
	{
		Destroy();
	}
}

void ARakisCinematicTrigger::SetPlayerCinematicMode(bool bEnable)
{
	if (bEnable == bCinematicModeApplied)
	{
		return;
	}
	bCinematicModeApplied = bEnable;

	if (bLockInput)
	{
		if (ARakisCharacter* Character = Cast<ARakisCharacter>(UGameplayStatics::GetPlayerPawn(this, 0)))
		{
			Character->SetInputLocked(bEnable);
		}
	}

	if (bHideHUD)
	{
		APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
		AHUD* HUD = PC ? PC->GetHUD() : nullptr;
		if (HUD)
		{
			if (bEnable)
			{
				bHUDWasShown = HUD->bShowHUD;
				HUD->bShowHUD = false;
			}
			else
			{
				HUD->bShowHUD = bHUDWasShown;
			}
		}
	}
}

ARakisCinematicTrigger* ARakisCinematicTrigger::PlaySequenceAtRuntime(UObject* WorldContextObject, const FSoftObjectPath& SequencePath, bool bForceWormInFallback)
{
	UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	if (!World)
	{
		return nullptr;
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.bDeferConstruction = true;
	ARakisCinematicTrigger* Trigger = World->SpawnActor<ARakisCinematicTrigger>(ARakisCinematicTrigger::StaticClass(), FTransform::Identity, Params);
	if (!Trigger)
	{
		return nullptr;
	}
	Trigger->Sequence = TSoftObjectPtr<ULevelSequence>(SequencePath);
	Trigger->bAutoPlayOnOverlap = false;
	Trigger->bPlayOnce = true;
	Trigger->bDestroyOnFinish = true;
	Trigger->bFallbackForceWormSurface = bForceWormInFallback;
	Trigger->FinishSpawning(FTransform::Identity);
	// Запускаем сразу: OnFinished приходит не раньше следующего кадра (таймер фоллбека или плеер),
	// поэтому вызывающий успевает подписаться на возвращённый актор.
	Trigger->FallbackDuration = FMath::Max(Trigger->FallbackDuration, 0.1f);
	Trigger->Play();
	return Trigger;
}
