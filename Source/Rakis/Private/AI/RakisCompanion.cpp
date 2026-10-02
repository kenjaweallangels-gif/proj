#include "AI/RakisCompanion.h"

#include "Rakis.h"
#include "RakisAIVisuals.h"
#include "Audio/RakisAudioDirector.h"
#include "Narrative/RakisDialogueSubsystem.h"

#include "AIController.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Navigation/PathFollowingComponent.h"
#include "TimerManager.h"

namespace RakisCompanionIds
{
	static const FName Ilva(TEXT("Ilva"));
	static const FName Rayn(TEXT("Rayn"));
	static const FName Ossana(TEXT("Ossana"));
}

ARakisCompanion::ARakisCompanion(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;

	AIControllerClass = AAIController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	bUseControllerRotationYaw = false;

	GetCapsuleComponent()->InitCapsuleSize(34.f, 90.f);

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->bOrientRotationToMovement = true;
		Move->RotationRate = FRotator(0.f, 400.f, 0.f);
		Move->MaxWalkSpeed = 150.f;
		// Мягкий разгон/торможение — «человеческая» походка за игроком.
		Move->MaxAcceleration = 700.f;
		Move->BrakingDecelerationWalking = 500.f;
		// След в след — без RVO, иначе цепочка «расползается».
		Move->bUseRVOAvoidance = false;
	}

	if (USkeletalMeshComponent* MeshComp = GetMesh())
	{
		MeshComp->SetRelativeLocationAndRotation(FVector(0.f, 0.f, -90.f), FRotator(0.f, -90.f, 0.f));
	}

	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(GetCapsuleComponent());
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderBody->SetGenerateOverlapEvents(false);
	PlaceholderBody->SetCanEverAffectNavigation(false);
	PlaceholderBody->SetHiddenInGame(true);
}

void ARakisCompanion::BeginPlay()
{
	Super::BeginPlay();

	// Цвет заглушки по персонажу, если в деталях не задан свой.
	if (ClothTint.Equals(FLinearColor(0.35f, 0.3f, 0.25f)))
	{
		if (CompanionId == RakisCompanionIds::Ilva) { ClothTint = FLinearColor(0.16f, 0.2f, 0.3f); }
		else if (CompanionId == RakisCompanionIds::Rayn) { ClothTint = FLinearColor(0.5f, 0.38f, 0.22f); }
		else if (CompanionId == RakisCompanionIds::Ossana) { ClothTint = FLinearColor(0.18f, 0.13f, 0.1f); }
	}

	RakisAIVisuals::ApplyBody(this, HeroMeshPath, FallbackMesh, AnimClass, FallbackAnimClass, PlaceholderBody);
	RakisAIVisuals::ApplyTint(this, PlaceholderBody, ClothTint, ClothTintParam, TintMIDs);

	// Реплики спутника звучат из его позиции.
	if (URakisDialogueSubsystem* Dialogue = URakisDialogueSubsystem::Get(this))
	{
		Dialogue->RegisterSpeaker(CompanionId, this);
	}

	const float Period = 1.f / FMath::Clamp(LogicHz, 1.f, 30.f);
	GetWorldTimerManager().SetTimer(LogicTimer, this, &ARakisCompanion::LogicUpdate, Period, true);

	LastLogicTime = GetWorld()->GetTimeSeconds();
	LastProgressTime = LastLogicTime;
	LastProgressLocation = GetActorLocation();
}

void ARakisCompanion::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	GetWorldTimerManager().ClearTimer(LogicTimer);
	Super::EndPlay(EndPlayReason);
}

int32 ARakisCompanion::ResolveChainIndex() const
{
	if (ChainIndex > 0)
	{
		return ChainIndex;
	}
	if (CompanionId == RakisCompanionIds::Ilva) { return 1; }
	if (CompanionId == RakisCompanionIds::Rayn) { return 2; }
	if (CompanionId == RakisCompanionIds::Ossana) { return 3; }
	return 1;
}

void ARakisCompanion::SetFollowEnabled(bool bEnabled)
{
	if (bFollowEnabled == bEnabled)
	{
		return;
	}
	bFollowEnabled = bEnabled;
	bRecovering = false;
	bMovingOnTrail = false;
	if (AAIController* AI = Cast<AAIController>(GetController()))
	{
		AI->StopMovement();
	}
	if (bEnabled)
	{
		ResetTrail();
	}
}

void ARakisCompanion::ResetTrail()
{
	Crumbs.Reset();
	Cursor = 0;
	if (const UWorld* World = GetWorld())
	{
		LastProgressTime = World->GetTimeSeconds();
	}
	LastProgressLocation = GetActorLocation();
}

// ---------------------------------------------------------------------------------------------
// След
// ---------------------------------------------------------------------------------------------

void ARakisCompanion::RecordCrumb(const FVector& PlayerLocation)
{
	if (Crumbs.Num() > 0)
	{
		const float Step = FVector::Dist(Crumbs.Last(), PlayerLocation);
		if (Step < CrumbSpacing)
		{
			return;
		}
		// Скачок (телепорт игрока, кат-сцена) — старый след недействителен.
		if (Step > 1000.f)
		{
			ResetTrail();
		}
	}
	Crumbs.Add(PlayerLocation);

	// Ограничиваем память: пройденное отрезаем.
	if (Crumbs.Num() > 1024 || Cursor > 128)
	{
		const int32 Cut = FMath::Clamp(Cursor - 4, 0, Crumbs.Num() - 1);
		if (Cut > 0)
		{
			Crumbs.RemoveAt(0, Cut, EAllowShrinking::No);
			Cursor -= Cut;
		}
	}
}

void ARakisCompanion::AdvanceCursor()
{
	const FVector Loc = GetActorLocation();
	const float ReachSq = FMath::Square(CrumbReachRadius);

	while (Cursor < Crumbs.Num() && FVector::DistSquared2D(Loc, Crumbs[Cursor]) < ReachSq)
	{
		++Cursor;
	}
	// Срезали угол (толчок, коллизия) — перескакиваем на ближайшую впереди достигнутую крошку.
	const int32 LookAhead = FMath::Min(Cursor + 8, Crumbs.Num());
	for (int32 i = Cursor + 1; i < LookAhead; ++i)
	{
		if (FVector::DistSquared2D(Loc, Crumbs[i]) < ReachSq)
		{
			Cursor = i + 1;
		}
	}
}

float ARakisCompanion::TrailLengthFromCursor(const FVector& PlayerLocation) const
{
	const FVector Loc = GetActorLocation();
	if (Cursor >= Crumbs.Num())
	{
		return FVector::Dist2D(Loc, PlayerLocation);
	}
	float Length = FVector::Dist2D(Loc, Crumbs[Cursor]);
	for (int32 i = Cursor; i + 1 < Crumbs.Num(); ++i)
	{
		Length += FVector::Dist2D(Crumbs[i], Crumbs[i + 1]);
	}
	Length += FVector::Dist2D(Crumbs.Last(), PlayerLocation);
	return Length;
}

FVector ARakisCompanion::PointOnTrailBehindPlayer(const FVector& PlayerLocation, float Distance) const
{
	FVector Prev = PlayerLocation;
	float Remaining = Distance;
	for (int32 i = Crumbs.Num() - 1; i >= 0; --i)
	{
		const float Seg = FVector::Dist(Prev, Crumbs[i]);
		if (Seg >= Remaining && Seg > KINDA_SMALL_NUMBER)
		{
			return FMath::Lerp(Prev, Crumbs[i], Remaining / Seg);
		}
		Remaining -= Seg;
		Prev = Crumbs[i];
	}
	return Prev;
}

// ---------------------------------------------------------------------------------------------
// Рулёжка (каждый кадр) и логика (LogicHz)
// ---------------------------------------------------------------------------------------------

void ARakisCompanion::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player)
	{
		return;
	}
	const FVector PlayerLoc = Player->GetActorLocation();
	bMovingOnTrail = false;

	if (IsFollowing() && !bRecovering)
	{
		RecordCrumb(PlayerLoc);
		AdvanceCursor();

		const float Gap = ResolveChainIndex() * ChainSpacing;
		const float Remaining = TrailLengthFromCursor(PlayerLoc);
		if (Remaining > Gap + GapTolerance)
		{
			const FVector Target = Cursor < Crumbs.Num() ? Crumbs[Cursor] : PlayerLoc;
			const FVector Dir = (Target - GetActorLocation()).GetSafeNormal2D();
			if (!Dir.IsNearlyZero())
			{
				AddMovementInput(Dir, 1.f);
				bMovingOnTrail = true;
			}
		}

		if (UCharacterMovementComponent* Move = GetCharacterMovement())
		{
			Move->MaxWalkSpeed = FMath::FInterpTo(Move->MaxWalkSpeed, DesiredSpeed, DeltaSeconds, 3.f);
		}
	}

	// Стоим и игрок стоит — повернуться к нему.
	if (!bMovingOnTrail && !bRecovering && bLookAtPlayer && PlayerStillTime > IdleTurnDelay && GetVelocity().Size2D() < 10.f)
	{
		const float TargetYaw = (PlayerLoc - GetActorLocation()).Rotation().Yaw;
		const float Delta = FMath::FindDeltaAngleDegrees(GetActorRotation().Yaw, TargetYaw);
		if (FMath::Abs(Delta) > 25.f)
		{
			const FRotator NewRot = FMath::RInterpTo(FRotator(0.f, GetActorRotation().Yaw, 0.f), FRotator(0.f, TargetYaw, 0.f), DeltaSeconds, TurnInterpSpeed);
			SetActorRotation(NewRot);
		}
	}
}

void ARakisCompanion::LogicUpdate()
{
	UWorld* World = GetWorld();
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!World || !Player)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const float Elapsed = Now - LastLogicTime;
	LastLogicTime = Now;

	const FVector PlayerLoc = Player->GetActorLocation();
	const float Dist = FVector::Dist(GetActorLocation(), PlayerLoc);
	const float PlayerSpeed = Player->GetVelocity().Size2D();

	// Шаги спутника (DT_AudioEvents Trigger "Footstep:Companion") — пока нет AnimNotify, по пройденному пути.
	const float MySpeed = GetVelocity().Size2D();
	if (MySpeed > 40.f && Dist < FootstepAudibleRadius && !GetCharacterMovement()->IsFalling())
	{
		StrideAccumulator += MySpeed * Elapsed;
		if (StrideAccumulator >= StrideLength)
		{
			StrideAccumulator = 0.f;
			if (URakisAudioDirector* Audio = URakisAudioDirector::Get(this))
			{
				const float HalfHeight = GetCapsuleComponent()->GetScaledCapsuleHalfHeight();
				Audio->PostEventByTrigger(TEXT("Footstep:Companion"), GetActorLocation() - FVector(0.f, 0.f, HalfHeight));
			}
		}
	}
	else
	{
		StrideAccumulator = 0.f;
	}

	// Взгляд.
	bLookAtPlayer = Dist <= LookAtRadius;
	if (bLookAtPlayer)
	{
		LookAtTarget = Player->GetPawnViewLocation();
	}
	PlayerStillTime = PlayerSpeed < 20.f ? PlayerStillTime + Elapsed : 0.f;

	// Присоединение к цепочке.
	if (!bJoined)
	{
		if (Dist <= JoinRadius)
		{
			bJoined = true;
			ResetTrail();
			UE_LOG(LogRakis, Log, TEXT("Companion %s: присоединился к цепочке (#%d)."), *CompanionId.ToString(), ResolveChainIndex());
		}
		return;
	}
	if (!bFollowEnabled)
	{
		return;
	}

	const float Gap = ResolveChainIndex() * ChainSpacing;
	AAIController* AI = Cast<AAIController>(GetController());

	// Восстановление через навигацию.
	if (bRecovering)
	{
		const bool bMoveDone = !AI || AI->GetMoveStatus() == EPathFollowingStatus::Idle;
		if (Dist < Gap + 300.f || bMoveDone)
		{
			bRecovering = false;
			if (AI)
			{
				AI->StopMovement();
			}
			ResetTrail();
		}
		else if (Dist > TeleportDistance)
		{
			TeleportBehindPlayer(Player);
		}
		return;
	}

	if (Dist > TeleportDistance)
	{
		TeleportBehindPlayer(Player);
		return;
	}
	if (Dist > RecoverDistance)
	{
		StartRecovery(Player);
		return;
	}

	// Застревание: идём по следу, но не двигаемся.
	if (bMovingOnTrail)
	{
		if (FVector::Dist2D(GetActorLocation(), LastProgressLocation) > 25.f)
		{
			LastProgressLocation = GetActorLocation();
			LastProgressTime = Now;
		}
		else if (Now - LastProgressTime > StuckSeconds)
		{
			StartRecovery(Player);
			return;
		}
	}
	else
	{
		LastProgressLocation = GetActorLocation();
		LastProgressTime = Now;
	}

	// Скорость: как у игрока + догоняние пропорционально отставанию.
	const float Lag = FMath::Max(0.f, TrailLengthFromCursor(PlayerLoc) - Gap);
	DesiredSpeed = FMath::Clamp(PlayerSpeed + CatchUpGain * Lag, MinWalkSpeed, MaxCatchUpSpeed);
}

void ARakisCompanion::StartRecovery(const APawn* Player)
{
	AAIController* AI = Cast<AAIController>(GetController());
	const FVector PlayerLoc = Player->GetActorLocation();
	const float Gap = ResolveChainIndex() * ChainSpacing;
	const FVector Target = Crumbs.Num() > 0 ? PointOnTrailBehindPlayer(PlayerLoc, Gap) : PlayerLoc;

	if (AI)
	{
		const EPathFollowingRequestResult::Type Result = AI->MoveToLocation(Target, Gap * 0.5f,
			/*bStopOnOverlap*/ true, /*bUsePathfinding*/ true, /*bProjectDestinationToNavigation*/ true,
			/*bCanStrafe*/ false, nullptr, /*bAllowPartialPath*/ true);
		if (Result != EPathFollowingRequestResult::Failed)
		{
			bRecovering = true;
			if (UCharacterMovementComponent* Move = GetCharacterMovement())
			{
				Move->MaxWalkSpeed = MaxCatchUpSpeed;
			}
			return;
		}
	}
	// Навигация недоступна — телепорт (только вне кадра), иначе просто сбрасываем след и идём напрямую.
	if (!WasRecentlyRendered(0.5f))
	{
		TeleportBehindPlayer(Player);
	}
	else
	{
		ResetTrail();
	}
}

void ARakisCompanion::TeleportBehindPlayer(const APawn* Player)
{
	// Не телепортируем на глазах у игрока.
	if (WasRecentlyRendered(0.5f))
	{
		return;
	}
	const FVector PlayerLoc = Player->GetActorLocation();
	const float Gap = ResolveChainIndex() * ChainSpacing;
	FVector Dest = Crumbs.Num() > 0
		? PointOnTrailBehindPlayer(PlayerLoc, Gap)
		: PlayerLoc - Player->GetActorForwardVector().GetSafeNormal2D() * Gap;

	const FRotator Facing(0.f, (PlayerLoc - Dest).Rotation().Yaw, 0.f);
	if (TeleportTo(Dest, Facing))
	{
		if (AAIController* AI = Cast<AAIController>(GetController()))
		{
			AI->StopMovement();
		}
		bRecovering = false;
		ResetTrail();
		UE_LOG(LogRakis, Log, TEXT("Companion %s: телепорт к игроку."), *CompanionId.ToString());
	}
}
