#include "AI/RakisCitizen.h"

#include "Rakis.h"
#include "AI/RakisCrowdSubsystem.h"
#include "Audio/RakisAudioDirector.h"
#include "Narrative/RakisDialogueSubsystem.h"
#include "RakisAIVisuals.h"

#include "AIController.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "NavigationSystem.h"
#include "Navigation/PathFollowingComponent.h"
#include "TimerManager.h"

namespace RakisCitizenCtx
{
	static const FName Stranger(TEXT("Stranger"));
	static const FName Market(TEXT("Market"));
	static const FName Water(TEXT("Water"));
	static const FName Shiana(TEXT("Shiana"));
	static const FName Kin(TEXT("Kin"));
	static const FName Offworld(TEXT("Offworld"));
	static const FName Ritual(TEXT("Ritual"));
	static const FName Idle(TEXT("Idle"));

	static const FName SpotStall(TEXT("Stall"));
	static const FName SpotWaterJar(TEXT("WaterJar"));
	static const FName AgeChild(TEXT("Child"));
}

ARakisCitizen::ARakisCitizen(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
{
	// Tick включается только на время доворота корпуса.
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;

	AIControllerClass = AAIController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	bUseControllerRotationYaw = false;

	GetCapsuleComponent()->InitCapsuleSize(34.f, 90.f);

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->bOrientRotationToMovement = true;
		Move->RotationRate = FRotator(0.f, 300.f, 0.f);
		Move->MaxWalkSpeed = 120.f;
		Move->bUseRVOAvoidance = true;
		Move->AvoidanceConsiderationRadius = 300.f;
	}

	if (USkeletalMeshComponent* MeshComp = GetMesh())
	{
		MeshComp->SetRelativeLocationAndRotation(FVector(0.f, 0.f, -90.f), FRotator(0.f, -90.f, 0.f));
		// Позу считаем только когда видно — толпа из 60 человек дорогая.
		MeshComp->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::OnlyTickPoseWhenRendered;
	}

	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(GetCapsuleComponent());
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderBody->SetGenerateOverlapEvents(false);
	PlaceholderBody->SetCanEverAffectNavigation(false);
	PlaceholderBody->SetHiddenInGame(true);
}

void ARakisCitizen::InitCitizen(FName InArchetype, int32 InSeed)
{
	Archetype = InArchetype;
	Seed = InSeed;
	Rng.Initialize(Seed);
	bInitialized = true;
}

URakisCrowdSubsystem* ARakisCitizen::GetCrowd() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetSubsystem<URakisCrowdSubsystem>() : nullptr;
}

void ARakisCitizen::BeginPlay()
{
	Super::BeginPlay();

	if (!bInitialized)
	{
		// Расставленный руками горожанин: зерно из имени, чтобы поведение было стабильным между запусками.
		Rng.Initialize(Seed != 0 ? Seed : static_cast<int32>(GetTypeHash(GetFName())));
		bInitialized = true;
	}

	ApplyArchetype();

	const float Now = GetWorld()->GetTimeSeconds();
	Activity = ERakisCitizenActivity::Idle;
	ActivityEndTime = Now + Rng.FRandRange(0.5f, 4.f);
	NextBarkTime = Now + Rng.FRandRange(5.f, BarkCooldownMax);

	const float Period = 1.f / FMath::Clamp(BehaviourHz, 1.f, 20.f);
	GetWorldTimerManager().SetTimer(BehaviourTimer, this, &ARakisCitizen::BehaviourUpdate, Period, true, Rng.FRandRange(0.f, Period));

	if (URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		Crowd->RegisterCitizen(this);
	}
}

void ARakisCitizen::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	GetWorldTimerManager().ClearTimer(BehaviourTimer);
	SetTalking(false);
	ReleaseCurrentSpot();
	if (URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		Crowd->UnregisterCitizen(this);
	}
	Super::EndPlay(EndPlayReason);
}

void ARakisCitizen::ApplyArchetype()
{
	const URakisCrowdSubsystem* Crowd = GetCrowd();
	const FRakisCrowdArchetypeRow* Row = Crowd ? Crowd->FindArchetype(Archetype) : nullptr;
	if (!Row)
	{
		RakisAIVisuals::WarnOnce(FString::Printf(TEXT("Archetype.%s"), *Archetype.ToString()),
			FString::Printf(TEXT("Crowd: архетип '%s' не найден — используются значения по умолчанию."), *Archetype.ToString()));
	}

	BaseWalkSpeed = Row ? FMath::Max(Row->WalkSpeed, 40.f) : 120.f;
	BaseWalkSpeed *= Rng.FRandRange(0.9f, 1.1f);
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->MaxWalkSpeed = BaseWalkSpeed;
	}

	// Дети — меньше капсула и меш.
	if (Row && Row->AgeGroup == RakisCitizenCtx::AgeChild)
	{
		const float ChildHalfHeight = 62.f;
		GetCapsuleComponent()->SetCapsuleSize(24.f, ChildHalfHeight);
		if (USkeletalMeshComponent* MeshComp = GetMesh())
		{
			MeshComp->SetRelativeLocation(FVector(0.f, 0.f, -ChildHalfHeight));
			MeshComp->SetRelativeScale3D(FVector(0.68f));
		}
	}

	RakisAIVisuals::ApplyBody(this, Row ? Row->BaseMesh : FString(), FallbackMesh, AnimClass, FallbackAnimClass, PlaceholderBody);

	const FLinearColor Tint = RakisAIVisuals::PickPaletteColor(Row ? Row->ClothPalette : FString(), Rng, FLinearColor(0.45f, 0.36f, 0.26f));
	RakisAIVisuals::ApplyTint(this, PlaceholderBody, Tint, ClothTintParam, TintMIDs);
}

// ---------------------------------------------------------------------------------------------
// Движение
// ---------------------------------------------------------------------------------------------

bool ARakisCitizen::MoveToPoint(const FVector& Destination, float AcceptanceRadius)
{
	AAIController* AI = Cast<AAIController>(GetController());
	if (!AI)
	{
		return false;
	}
	EPathFollowingRequestResult::Type Result = AI->MoveToLocation(Destination, AcceptanceRadius,
		/*bStopOnOverlap*/ true, /*bUsePathfinding*/ true, /*bProjectDestinationToNavigation*/ true,
		/*bCanStrafe*/ false, nullptr, /*bAllowPartialPath*/ true);

	if (Result == EPathFollowingRequestResult::Failed)
	{
		// Нет навмеша (ранний блокаут) — прямое движение.
		Result = AI->MoveToLocation(Destination, AcceptanceRadius, true, /*bUsePathfinding*/ false, false, false, nullptr, true);
	}
	if (Result == EPathFollowingRequestResult::Failed)
	{
		RakisAIVisuals::WarnOnce(TEXT("Citizen.MoveFailed"), TEXT("Crowd: MoveTo не удаётся (нет NavMesh?) — горожане стоят на месте."));
		return false;
	}

	const float Now = GetWorld()->GetTimeSeconds();
	const float Speed = FMath::Max(GetCharacterMovement() ? GetCharacterMovement()->MaxWalkSpeed : 120.f, 50.f);
	MoveGoal = Destination;
	MoveDeadline = Now + FVector::Dist(GetActorLocation(), Destination) / Speed * 2.5f + 4.f;
	return true;
}

bool ARakisCitizen::IsMoveDone() const
{
	const AAIController* AI = Cast<AAIController>(GetController());
	return !AI || AI->GetMoveStatus() == EPathFollowingStatus::Idle;
}

void ARakisCitizen::StopMoving()
{
	if (AAIController* AI = Cast<AAIController>(GetController()))
	{
		AI->StopMovement();
	}
}

// ---------------------------------------------------------------------------------------------
// Поведение
// ---------------------------------------------------------------------------------------------

void ARakisCitizen::BehaviourUpdate()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	const float Dist = Player ? FVector::Dist(Player->GetActorLocation(), GetActorLocation()) : TNumericLimits<float>::Max();
	const bool bRitual = Activity == ERakisCitizenActivity::RitualWalk || Activity == ERakisCitizenActivity::RitualGathered;

	// Значимость: далеко от игрока — ничего не решаем (движение по уже выданному пути продолжается само).
	if (Dist > SignificanceRadius && !bRitual)
	{
		bLookAtPlayer = false;
		bHasLookAtTarget = false;
		return;
	}

	UpdateLookAt(Player, Dist);

	if (TryStepAside(Player, Dist, Now))
	{
		return;
	}

	switch (Activity)
	{
	case ERakisCitizenActivity::Idle:
		if (Now >= ActivityEndTime)
		{
			ChooseNextActivity(Now);
		}
		break;

	case ERakisCitizenActivity::MovingToSpot:
		if (IsMoveDone() || Now > MoveDeadline)
		{
			if (CurrentSpot.IsValid() && FVector::Dist2D(GetActorLocation(), MoveGoal) < 150.f)
			{
				ArriveAtSpot(Now);
			}
			else
			{
				StopMoving();
				ReleaseCurrentSpot();
				Activity = ERakisCitizenActivity::Idle;
				ActivityEndTime = Now + Rng.FRandRange(0.5f, 2.f);
			}
		}
		break;

	case ERakisCitizenActivity::Wandering:
		if (IsMoveDone() || Now > MoveDeadline)
		{
			StopMoving();
			Activity = ERakisCitizenActivity::Idle;
			ActivityEndTime = Now + Rng.FRandRange(WanderIdleMin, WanderIdleMax);
		}
		break;

	case ERakisCitizenActivity::UsingSpot:
		if (Now >= ActivityEndTime)
		{
			SetTalking(false);
			ReleaseCurrentSpot();
			ChooseNextActivity(Now);
		}
		else
		{
			UpdateSpotSound(Dist, Now);
		}
		break;

	case ERakisCitizenActivity::SteppingAside:
		if (IsMoveDone() || Now > ActivityEndTime)
		{
			ResumeAfterStepAside(Now);
		}
		break;

	case ERakisCitizenActivity::RitualWalk:
		if (FVector::Dist2D(GetActorLocation(), RitualGatherPoint) < 200.f && IsMoveDone())
		{
			Activity = ERakisCitizenActivity::RitualGathered;
			StopMoving();
			if (bHasHallCentre)
			{
				RequestTurnTo((HallCentre - GetActorLocation()).Rotation().Yaw);
			}
		}
		else if (IsMoveDone() && Now >= RitualRetryTime)
		{
			// Путь сорвался (толкотня, частичный путь) — повторяем не чаще раза в секунду.
			RitualRetryTime = Now + 1.f;
			MoveToPoint(RitualGatherPoint, 60.f);
		}
		break;

	case ERakisCitizenActivity::RitualGathered:
	default:
		break;
	}

	UpdateBarks(Player, Dist, Now);
}

void ARakisCitizen::ChooseNextActivity(float Now)
{
	URakisCrowdSubsystem* Crowd = GetCrowd();
	const FVector Loc = GetActorLocation();

	if (Crowd && Rng.FRand() < SpotChance)
	{
		const TArray<FName> Types = Crowd->GetArchetypeSpotTypes(Archetype);
		if (Types.Num() > 0)
		{
			FName Type;
			if (AActor* Spot = Crowd->ReserveSpot(this, Types, Loc, SpotSearchRadius, Rng, Type))
			{
				CurrentSpot = Spot;
				CurrentSpotType = Type;
				FVector Goal = Spot->GetActorLocation();
				// Общая точка (скамья, прилавок) — встаём рядом, а не в одну точку.
				if (Crowd->GetSpotOccupancy(Spot) > 1)
				{
					const float Angle = Rng.FRandRange(0.f, 2.f * PI);
					Goal += FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * Rng.FRandRange(50.f, 90.f);
				}
				if (MoveToPoint(Goal, 30.f))
				{
					Activity = ERakisCitizenActivity::MovingToSpot;
					return;
				}
				ReleaseCurrentSpot();
			}
		}
	}

	// Прогулка: случайная достижимая точка.
	FVector Dest = Loc;
	bool bFound = false;
	if (UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(GetWorld()))
	{
		FNavLocation NavLoc;
		if (Nav->GetRandomReachablePointInRadius(Loc, WanderRadius, NavLoc))
		{
			Dest = NavLoc.Location;
			bFound = true;
		}
	}
	if (!bFound)
	{
		const float Angle = Rng.FRandRange(0.f, 2.f * PI);
		Dest = Loc + FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * Rng.FRandRange(200.f, WanderRadius * 0.5f);
	}

	if (MoveToPoint(Dest, 50.f))
	{
		Activity = ERakisCitizenActivity::Wandering;
	}
	else
	{
		Activity = ERakisCitizenActivity::Idle;
		ActivityEndTime = Now + Rng.FRandRange(WanderIdleMin, WanderIdleMax);
	}
}

void ARakisCitizen::ArriveAtSpot(float Now)
{
	Activity = ERakisCitizenActivity::UsingSpot;
	ActivityEndTime = Now + Rng.FRandRange(SpotIdleMin, SpotIdleMax);
	StopMoving();

	if (const AActor* Spot = CurrentSpot.Get())
	{
		// Точки размечены лицом к станку/прилавку/кувшину.
		RequestTurnTo(Spot->GetActorRotation().Yaw);

		const URakisCrowdSubsystem* Crowd = GetCrowd();
		const int32 Others = Crowd ? Crowd->GetSpotOccupancy(Spot) - 1 : 0;
		// Вдвоём-втроём на точке разговаривают охотнее.
		const float Chance = FMath::Clamp(TalkChance * (Others > 0 ? 1.6f : 1.f), 0.f, 1.f);
		SetTalking(Rng.FRand() < Chance);
	}
	NextSpotSoundTime = Now;
}

void ARakisCitizen::UpdateSpotSound(float DistToPlayer, float Now)
{
	// Звук работы на точке (станок, кувшин, починка): Trigger "SmartObject:<Type>", только рядом с игроком.
	const AActor* Spot = CurrentSpot.Get();
	if (!Spot || CurrentSpotType.IsNone() || DistToPlayer > SpotSoundRadius || Now < NextSpotSoundTime)
	{
		return;
	}
	NextSpotSoundTime = Now + Rng.FRandRange(SpotSoundIntervalMin, SpotSoundIntervalMax);
	if (URakisAudioDirector* Audio = URakisAudioDirector::Get(this))
	{
		Audio->PostEventByTrigger(FName(*FString::Printf(TEXT("SmartObject:%s"), *CurrentSpotType.ToString())), Spot->GetActorLocation());
	}
}

void ARakisCitizen::ReleaseCurrentSpot()
{
	if (AActor* Spot = CurrentSpot.Get())
	{
		if (URakisCrowdSubsystem* Crowd = GetCrowd())
		{
			Crowd->ReleaseSpot(this, Spot);
		}
	}
	CurrentSpot.Reset();
	CurrentSpotType = NAME_None;
}

void ARakisCitizen::SetTalking(bool bTalking)
{
	if (bIsTalking == bTalking)
	{
		return;
	}
	bIsTalking = bTalking;
	if (!bTalking)
	{
		bConversationSilenced = false;
	}
	if (URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		Crowd->SetTalking(this, bTalking);
	}
}

void ARakisCitizen::SetConversationSilenced(bool bSilenced)
{
	bConversationSilenced = bSilenced && bIsTalking;
}

// ---------------------------------------------------------------------------------------------
// Реакции на игрока
// ---------------------------------------------------------------------------------------------

void ARakisCitizen::UpdateLookAt(const APawn* Player, float DistToPlayer)
{
	bLookAtPlayer = false;
	bHasLookAtTarget = false;

	if (Activity == ERakisCitizenActivity::RitualGathered)
	{
		if (bHasHallCentre)
		{
			LookAtTarget = HallCentre + FVector(0.f, 0.f, 120.f);
			bHasLookAtTarget = true;
		}
		return;
	}

	const bool bStopped = GetVelocity().Size2D() < 15.f;
	const bool bCanTurnBody = bStopped && (Activity == ERakisCitizenActivity::Idle || Activity == ERakisCitizenActivity::UsingSpot);

	if (Player && DistToPlayer <= LookAtRadius)
	{
		const FVector ToPlayer = (Player->GetActorLocation() - GetActorLocation()).GetSafeNormal2D();
		const float Dot = FVector::DotProduct(GetActorForwardVector().GetSafeNormal2D(), ToPlayer);

		// Идущий не оборачивается на того, кто сзади; стоящий — оборачивается.
		if (Dot > -0.2f || bCanTurnBody)
		{
			bLookAtPlayer = true;
			bHasLookAtTarget = true;
			LookAtTarget = Player->GetPawnViewLocation();

			const float AngleDeg = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(Dot, -1.f, 1.f)));
			if (bCanTurnBody && AngleDeg > BodyTurnThresholdDeg)
			{
				RequestTurnTo(ToPlayer.Rotation().Yaw);
			}
		}
		return;
	}

	// Игрок ушёл — вернуться лицом к своей точке.
	if (Activity == ERakisCitizenActivity::UsingSpot && bStopped && !bWantsTurn)
	{
		if (const AActor* Spot = CurrentSpot.Get())
		{
			const float SpotYaw = Spot->GetActorRotation().Yaw;
			if (FMath::Abs(FMath::FindDeltaAngleDegrees(GetActorRotation().Yaw, SpotYaw)) > 10.f)
			{
				RequestTurnTo(SpotYaw);
			}
		}
	}
}

void ARakisCitizen::RequestTurnTo(float Yaw)
{
	DesiredYaw = Yaw;
	bWantsTurn = true;
	SetActorTickEnabled(true);
}

void ARakisCitizen::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Tick нужен только для плавного доворота стоящего горожанина.
	if (!bWantsTurn || GetVelocity().Size2D() > 20.f)
	{
		bWantsTurn = false;
		SetActorTickEnabled(false);
		return;
	}
	const FRotator Current = GetActorRotation();
	const FRotator Target(0.f, DesiredYaw, 0.f);
	const FRotator NewRot = FMath::RInterpTo(FRotator(0.f, Current.Yaw, 0.f), Target, DeltaSeconds, TurnInterpSpeed);
	SetActorRotation(NewRot);
	if (FMath::Abs(FMath::FindDeltaAngleDegrees(NewRot.Yaw, DesiredYaw)) < 2.f)
	{
		bWantsTurn = false;
		SetActorTickEnabled(false);
	}
}

bool ARakisCitizen::TryStepAside(const APawn* Player, float DistToPlayer, float Now)
{
	if (!Player || DistToPlayer > StepAsideRadius || Now < NextStepAsideTime)
	{
		return false;
	}
	if (Activity == ERakisCitizenActivity::SteppingAside || Activity == ERakisCitizenActivity::RitualGathered)
	{
		return false;
	}

	const FVector Loc = GetActorLocation();
	const FVector ToMe = (Loc - Player->GetActorLocation()).GetSafeNormal2D();
	const FVector PlayerVel = Player->GetVelocity();
	const FVector MyVel = GetVelocity();

	const bool bPlayerComing = PlayerVel.Size2D() > 40.f && FVector::DotProduct(PlayerVel.GetSafeNormal2D(), ToMe) > 0.5f;
	const bool bWeHeadInto = MyVel.Size2D() > 30.f && FVector::DotProduct(MyVel.GetSafeNormal2D(), -ToMe) > 0.6f;
	if (!bPlayerComing && !bWeHeadInto)
	{
		return false;
	}

	// Направление «тропы», с которой уходим, и перпендикуляр к ней — в ту сторону, где мы уже стоим.
	const FVector PathDir = bPlayerComing ? PlayerVel.GetSafeNormal2D() : -ToMe;
	FVector Side = FVector::CrossProduct(FVector::UpVector, PathDir).GetSafeNormal();
	if (FVector::DotProduct(Side, ToMe) < 0.f)
	{
		Side = -Side;
	}
	const FVector Target = Loc + Side * StepAsideDistance + (bPlayerComing ? PathDir * 30.f : FVector::ZeroVector);

	// Запомнить, к чему вернуться.
	switch (Activity)
	{
	case ERakisCitizenActivity::UsingSpot:
		ResumeActivity = ERakisCitizenActivity::MovingToSpot;
		ResumeGoal = MoveGoal;
		break;
	case ERakisCitizenActivity::MovingToSpot:
	case ERakisCitizenActivity::Wandering:
	case ERakisCitizenActivity::RitualWalk:
		ResumeActivity = Activity;
		ResumeGoal = Activity == ERakisCitizenActivity::RitualWalk ? RitualGatherPoint : MoveGoal;
		break;
	default:
		ResumeActivity = ERakisCitizenActivity::Idle;
		ResumeGoal = Loc;
		break;
	}

	NextStepAsideTime = Now + StepAsideCooldown;
	if (!MoveToPoint(Target, 20.f))
	{
		return false;
	}
	bWantsTurn = false;
	Activity = ERakisCitizenActivity::SteppingAside;
	ActivityEndTime = Now + 1.5f;
	return true;
}

void ARakisCitizen::ResumeAfterStepAside(float Now)
{
	const ERakisCitizenActivity Resume = ResumeActivity;
	ResumeActivity = ERakisCitizenActivity::Idle;

	switch (Resume)
	{
	case ERakisCitizenActivity::MovingToSpot:
		if (CurrentSpot.IsValid() && MoveToPoint(ResumeGoal, 30.f))
		{
			Activity = ERakisCitizenActivity::MovingToSpot;
			return;
		}
		ReleaseCurrentSpot();
		SetTalking(false);
		break;
	case ERakisCitizenActivity::Wandering:
		if (MoveToPoint(ResumeGoal, 50.f))
		{
			Activity = ERakisCitizenActivity::Wandering;
			return;
		}
		break;
	case ERakisCitizenActivity::RitualWalk:
		Activity = ERakisCitizenActivity::RitualWalk;
		RitualRetryTime = Now + 1.f;
		MoveToPoint(RitualGatherPoint, 60.f);
		return;
	default:
		break;
	}
	StopMoving();
	Activity = ERakisCitizenActivity::Idle;
	ActivityEndTime = Now + Rng.FRandRange(1.f, 3.f);
}

// ---------------------------------------------------------------------------------------------
// Лай
// ---------------------------------------------------------------------------------------------

bool ARakisCitizen::PlayBark(FName Context)
{
	UGameInstance* GI = UGameplayStatics::GetGameInstance(this);
	URakisDialogueSubsystem* Dialogue = GI ? GI->GetSubsystem<URakisDialogueSubsystem>() : nullptr;
	if (!Dialogue)
	{
		RakisAIVisuals::WarnOnce(TEXT("Citizen.NoDialogue"), TEXT("Crowd: URakisDialogueSubsystem недоступна — лай толпы отключён."));
		return false;
	}
	URakisCrowdSubsystem* Crowd = GetCrowd();
	if (Crowd && !Crowd->TryAcquireBarkSlot())
	{
		return false;
	}
	Dialogue->PlayBark(Archetype, Context, this);
	return true;
}

void ARakisCitizen::UpdateBarks(const APawn* Player, float DistToPlayer, float Now)
{
	if (!Player || DistToPlayer > BarkRadius)
	{
		bPlayerWasClose = false;
		return;
	}

	const bool bRitual = Activity == ERakisCitizenActivity::RitualWalk || Activity == ERakisCitizenActivity::RitualGathered;

	// «Чужак» — когда игрок проходит рядом (умолкший разговор тоже может буркнуть вслед).
	if (!bRitual && DistToPlayer < StrangerBarkRadius && !bPlayerWasClose)
	{
		bPlayerWasClose = true;
		if (Now >= NextStrangerBarkTime && Rng.FRand() < StrangerBarkChance)
		{
			if (PlayBark(RakisCitizenCtx::Stranger))
			{
				NextStrangerBarkTime = Now + StrangerBarkCooldown;
				NextBarkTime = FMath::Max(NextBarkTime, Now + BarkCooldownMin * 0.5f);
			}
		}
		return;
	}
	if (DistToPlayer > StrangerBarkRadius * 1.5f)
	{
		bPlayerWasClose = false;
	}

	if (Now < NextBarkTime)
	{
		return;
	}

	FName Context = NAME_None;
	if (Activity == ERakisCitizenActivity::RitualWalk)
	{
		if (Rng.FRand() < RitualBarkChance)
		{
			Context = RakisCitizenCtx::Ritual;
		}
	}
	else if (Activity == ERakisCitizenActivity::UsingSpot && bIsTalking && !bConversationSilenced)
	{
		const float Roll = Rng.FRand();
		if (CurrentSpotType == RakisCitizenCtx::SpotStall)
		{
			Context = Roll < 0.7f ? RakisCitizenCtx::Market : RakisCitizenCtx::Kin;
		}
		else if (CurrentSpotType == RakisCitizenCtx::SpotWaterJar)
		{
			Context = Roll < 0.7f ? RakisCitizenCtx::Water : RakisCitizenCtx::Kin;
		}
		else
		{
			// Слухи: Шиана чаще всего, десятина в Кине, чужие корабли.
			Context = Roll < 0.5f ? RakisCitizenCtx::Shiana : (Roll < 0.75f ? RakisCitizenCtx::Kin : RakisCitizenCtx::Offworld);
		}
	}
	else if ((Activity == ERakisCitizenActivity::UsingSpot || Activity == ERakisCitizenActivity::Idle) && !bIsTalking)
	{
		// Бормотание себе под нос — реже.
		if (Rng.FRand() < 0.3f)
		{
			Context = RakisCitizenCtx::Idle;
		}
	}

	if (!Context.IsNone() && PlayBark(Context))
	{
		NextBarkTime = Now + Rng.FRandRange(BarkCooldownMin, BarkCooldownMax);
	}
	else
	{
		// Не выпало/занято — следующий бросок не на каждом обновлении.
		NextBarkTime = Now + Rng.FRandRange(3.f, 8.f);
	}
}

// ---------------------------------------------------------------------------------------------
// Ритуал
// ---------------------------------------------------------------------------------------------

void ARakisCitizen::BeginRitualFlow(const FVector& GatherPoint)
{
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;

	SetTalking(false);
	ReleaseCurrentSpot();
	bWantsTurn = false;

	RitualGatherPoint = GatherPoint;
	if (const URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		bHasHallCentre = Crowd->GetHallCentre(HallCentre);
	}

	Activity = ERakisCitizenActivity::RitualWalk;
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->MaxWalkSpeed = BaseWalkSpeed * 1.05f;
	}
	RitualRetryTime = Now + 1.f;
	MoveToPoint(GatherPoint, 60.f);
	NextBarkTime = FMath::Min(NextBarkTime, Now + Rng.FRandRange(2.f, 10.f));
}
