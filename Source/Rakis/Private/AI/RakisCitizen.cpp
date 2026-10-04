#include "AI/RakisCitizen.h"

#include "Rakis.h"
#include "AI/RakisCrowdSubsystem.h"
#include "AI/RakisSmartObjects.h"
#include "Audio/RakisAudioDirector.h"
#include "Narrative/RakisDialogueSubsystem.h"
#include "RakisAIVisuals.h"

#include "AIController.h"
#include "Components/CapsuleComponent.h"
#include "Components/StateTreeComponent.h"
#include "HAL/IConsoleManager.h"
#include "StateTree.h"
#include "StructUtils/StructView.h"
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

	static TAutoConsoleVariable<int32> CVarUseStateTree(
		TEXT("Rakis.Crowd.StateTree"), 1,
		TEXT("1 — горожане работают от StateTree ST_Citizen, если ассет есть; 0 — C++-фоллбек (для новых горожан)."));

	static TAutoConsoleVariable<int32> CVarCrowdLOD(
		TEXT("Rakis.Crowd.LOD"), 1,
		TEXT("1 — LOD поведения горожан по расстоянию (редкий тик дальше 40 м, сон дальше 70 м); 0 — всегда полная частота."));
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

	// StateTree: дерево задаётся в BeginPlay (мягкая ссылка StateTreeAsset), автозапуск выключен —
	// без ассета компонент просто молчит, работает C++-фоллбек.
	StateTreeComp = CreateDefaultSubobject<UStateTreeComponent>(TEXT("StateTree"));
	StateTreeComp->SetStartLogicAutomatically(false);
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
	const float LODPeriod = FMath::Max(LODUpdateInterval, 0.1f);
	GetWorldTimerManager().SetTimer(LODTimer, this, &ARakisCitizen::UpdateLOD, LODPeriod, true, Rng.FRandRange(0.05f, LODPeriod));

	TryStartStateTree();

	// Регистрация после старта дерева: опоздавшим к ритуалу подсистема сразу зовёт BeginRitualFlow.
	if (URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		Crowd->RegisterCitizen(this);
	}
}

void ARakisCitizen::TryStartStateTree()
{
	bUsingStateTree = false;
	if (!StateTreeComp)
	{
		return;
	}
	if (RakisCitizenCtx::CVarUseStateTree.GetValueOnGameThread() == 0)
	{
		StateTreeComp->SetComponentTickEnabled(false);
		return;
	}
	URakisCrowdSubsystem* Crowd = GetCrowd();
	UStateTree* Tree = Crowd ? Crowd->GetCitizenStateTree(StateTreeAsset) : nullptr;
	if (!Tree)
	{
		// Без дерева компонент не нужен в тике (60 горожан).
		StateTreeComp->SetComponentTickEnabled(false);
		return;
	}
	StateTreeComp->SetComponentTickEnabled(true);
	StateTreeComp->SetStateTree(Tree);
	StateTreeComp->StartLogic();
	bUsingStateTree = StateTreeComp->IsRunning();
	if (!bUsingStateTree)
	{
		RakisAIVisuals::WarnOnce(TEXT("Citizen.STStartFailed"),
			FString::Printf(TEXT("Crowd: StateTree %s не запустился (схема/контекст-актор?) — C++-фоллбек."), *Tree->GetPathName()));
	}
}

void ARakisCitizen::FallBackToCpp(const TCHAR* Reason)
{
	if (!bUsingStateTree)
	{
		return;
	}
	RakisAIVisuals::WarnOnce(FString::Printf(TEXT("Citizen.STFallback.%s"), Reason),
		FString::Printf(TEXT("Crowd: горожане переходят со StateTree на C++-фоллбек: %s."), Reason));
	bUsingStateTree = false;
	if (StateTreeComp)
	{
		if (StateTreeComp->IsRunning())
		{
			StateTreeComp->StopLogic(Reason);
		}
		StateTreeComp->SetComponentTickEnabled(false);
	}
	SetSilenceDrivenByStateTree(false);
	const float Now = GetWorldNow();
	if (bRitualRequested)
	{
		BeginRitualWalk(Now);
		return;
	}
	LeaveSpot();
	StopMoving();
	BeginIdle(Rng.FRandRange(0.5f, 2.f));
}

void ARakisCitizen::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	GetWorldTimerManager().ClearTimer(BehaviourTimer);
	GetWorldTimerManager().ClearTimer(LODTimer);
	if (StateTreeComp && StateTreeComp->IsRunning())
	{
		StateTreeComp->StopLogic(TEXT("EndPlay"));
	}
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
// Движение и примитивы
// ---------------------------------------------------------------------------------------------

float ARakisCitizen::GetWorldNow() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetTimeSeconds() : 0.f;
}

const APawn* ARakisCitizen::GetPlayerAndDistance(float& OutDist) const
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	OutDist = Player ? FVector::Dist(Player->GetActorLocation(), GetActorLocation()) : TNumericLimits<float>::Max();
	return Player;
}

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

	const float Now = GetWorldNow();
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

bool ARakisCitizen::IsMoveFinished() const
{
	return IsMoveDone() || GetWorldNow() > MoveDeadline;
}

bool ARakisCitizen::IsAtMoveGoal(float Tolerance) const
{
	return FVector::Dist2D(GetActorLocation(), MoveGoal) < Tolerance;
}

void ARakisCitizen::StopMoving()
{
	if (AAIController* AI = Cast<AAIController>(GetController()))
	{
		AI->StopMovement();
	}
}

void ARakisCitizen::BeginIdle(float Duration)
{
	Activity = ERakisCitizenActivity::Idle;
	ActivityEndTime = GetWorldNow() + FMath::Max(Duration, 0.f);
}

bool ARakisCitizen::StartWander(float Radius)
{
	const float UseRadius = Radius > 0.f ? Radius : WanderRadius;
	const FVector Loc = GetActorLocation();
	FVector Dest = Loc;
	bool bFound = false;
	if (UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(GetWorld()))
	{
		FNavLocation NavLoc;
		if (Nav->GetRandomReachablePointInRadius(Loc, UseRadius, NavLoc))
		{
			Dest = NavLoc.Location;
			bFound = true;
		}
	}
	if (!bFound)
	{
		const float Angle = Rng.FRandRange(0.f, 2.f * PI);
		Dest = Loc + FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * Rng.FRandRange(200.f, FMath::Max(UseRadius * 0.5f, 250.f));
	}
	if (!MoveToPoint(Dest, 50.f))
	{
		return false;
	}
	Activity = ERakisCitizenActivity::Wandering;
	return true;
}

bool ARakisCitizen::ClaimSpotAndMove(float SearchRadius)
{
	URakisCrowdSubsystem* Crowd = GetCrowd();
	if (!Crowd)
	{
		return false;
	}
	const TArray<FName> Types = Crowd->GetArchetypeSpotTypes(Archetype);
	if (Types.Num() == 0)
	{
		return false;
	}
	ReleaseCurrentSpot();

	FName Type;
	AActor* Spot = Crowd->ReserveSpot(this, Types, GetActorLocation(), SearchRadius > 0.f ? SearchRadius : SpotSearchRadius, Rng, Type);
	if (!Spot)
	{
		return false;
	}
	CurrentSpot = Spot;
	CurrentSpotType = Type;

	FVector Goal = Spot->GetActorLocation();
	CurrentSpotYaw = Spot->GetActorRotation().Yaw;
	FTransform SlotTM;
	if (Crowd->GetReservedSlotTransform(this, SlotTM))
	{
		// Smart Object слот: своё место на скамье/у прилавка и направление взгляда слота.
		Goal = SlotTM.GetLocation();
		CurrentSpotYaw = SlotTM.Rotator().Yaw;
	}
	else if (Crowd->GetSpotOccupancy(Spot) > 1)
	{
		// Теговый фоллбек: общая точка (скамья, прилавок) — встаём рядом, а не в одну точку.
		const float Angle = Rng.FRandRange(0.f, 2.f * PI);
		Goal += FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * Rng.FRandRange(50.f, 90.f);
	}
	if (MoveToPoint(Goal, 30.f))
	{
		Activity = ERakisCitizenActivity::MovingToSpot;
		return true;
	}
	ReleaseCurrentSpot();
	return false;
}

void ARakisCitizen::LeaveSpot()
{
	SetTalking(false);
	const bool bWasOnSpot = Activity == ERakisCitizenActivity::MovingToSpot || Activity == ERakisCitizenActivity::UsingSpot;
	if (Activity == ERakisCitizenActivity::MovingToSpot)
	{
		StopMoving();
	}
	ReleaseCurrentSpot();
	if (bWasOnSpot)
	{
		Activity = ERakisCitizenActivity::Idle;
	}
}

// ---------------------------------------------------------------------------------------------
// Поведение (таймер BehaviourHz)
// ---------------------------------------------------------------------------------------------

void ARakisCitizen::BehaviourUpdate()
{
	if (!GetWorld())
	{
		return;
	}
	const float Now = GetWorldNow();
	float Dist = 0.f;
	const APawn* Player = GetPlayerAndDistance(Dist);
	const bool bRitual = Activity == ERakisCitizenActivity::RitualWalk || Activity == ERakisCitizenActivity::RitualGathered;

	if (BehaviourLOD == ERakisCitizenLOD::Dormant)
	{
		return;
	}

	if (bUsingStateTree)
	{
		// Решения — в StateTree; здесь только страховка и «фон» (лай, звук работы на точке).
		if (bRitualRequested && !bRitual && Now > RitualStateTreeDeadline)
		{
			// В дереве нет состояния ритуала (или оно не сработало) — контракт StartRitual важнее.
			FallBackToCpp(TEXT("RitualNotHandledByStateTree"));
			return;
		}
		if (StateTreeComp && !StateTreeComp->IsRunning() && !StateTreeComp->IsPaused())
		{
			// Корневое состояние завершилось — перезапуск; частые остановки = сломанное дерево.
			StateTreeRestarts = (Now - LastStateTreeRestartTime < 2.f) ? StateTreeRestarts + 1 : 0;
			LastStateTreeRestartTime = Now;
			if (StateTreeRestarts > 5)
			{
				FallBackToCpp(TEXT("StateTreeKeepsStopping"));
				return;
			}
			StateTreeComp->StartLogic();
		}
		UpdateReactions(Player, Dist, Now);
		return;
	}

	// C++-фоллбек. LOD Low — решения в 5 раз реже (путь на ритуал — всегда полная частота).
	if (BehaviourLOD == ERakisCitizenLOD::Low && !bRitual)
	{
		ClearLookAt();
		if ((++LowLODCounter % 5u) != 0u)
		{
			return;
		}
	}
	else
	{
		UpdateLookAt(Player, Dist);
	}

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
		if (IsMoveFinished())
		{
			if (CurrentSpot.IsValid() && IsAtMoveGoal())
			{
				ArriveAtSpot(Now);
			}
			else
			{
				StopMoving();
				ReleaseCurrentSpot();
				BeginIdle(Rng.FRandRange(0.5f, 2.f));
			}
		}
		break;

	case ERakisCitizenActivity::Wandering:
		if (IsMoveFinished())
		{
			StopMoving();
			BeginIdle(Rng.FRandRange(WanderIdleMin, WanderIdleMax));
		}
		break;

	case ERakisCitizenActivity::UsingSpot:
		if (Now >= ActivityEndTime)
		{
			SetTalking(false);
			ReleaseCurrentSpot();
			ChooseNextActivity(Now);
		}
		break;

	case ERakisCitizenActivity::SteppingAside:
		if (IsMoveDone() || Now > ActivityEndTime)
		{
			ResumeAfterStepAside(Now);
		}
		break;

	case ERakisCitizenActivity::RitualWalk:
		UpdateRitualWalk(Now);
		break;

	case ERakisCitizenActivity::RitualGathered:
	default:
		break;
	}

	UpdateReactions(Player, Dist, Now);
}

void ARakisCitizen::UpdateReactions(const APawn* Player, float Dist, float Now)
{
	if (Activity == ERakisCitizenActivity::UsingSpot)
	{
		UpdateSpotSound(Dist, Now);
	}
	UpdateBarks(Player, Dist, Now);
}

void ARakisCitizen::ChooseNextActivity(float Now)
{
	if (Rng.FRand() < SpotChance && ClaimSpotAndMove(SpotSearchRadius))
	{
		return;
	}
	if (!StartWander(WanderRadius))
	{
		BeginIdle(Rng.FRandRange(WanderIdleMin, WanderIdleMax));
	}
}

void ARakisCitizen::ArriveAtSpot(float Now, float DurationMin, float DurationMax)
{
	Activity = ERakisCitizenActivity::UsingSpot;
	StopMoving();

	float MinDur = DurationMin > 0.f ? DurationMin : SpotIdleMin;
	float MaxDur = DurationMax > 0.f ? DurationMax : SpotIdleMax;
	float TalkScale = 1.f;
	URakisCrowdSubsystem* Crowd = GetCrowd();
	if (Crowd)
	{
		// Smart Object: слот «занят» (MarkSlotAsOccupied), параметры — из поведения слота.
		if (const URakisSmartObjectBehaviorDefinition* Behavior = Crowd->MarkSpotInUse(this))
		{
			if (DurationMin <= 0.f && Behavior->UseDurationMin > 0.f) { MinDur = Behavior->UseDurationMin; }
			if (DurationMax <= 0.f && Behavior->UseDurationMax > 0.f) { MaxDur = Behavior->UseDurationMax; }
			TalkScale = FMath::Max(Behavior->TalkChanceScale, 0.f);
		}
	}
	ActivityEndTime = Now + Rng.FRandRange(MinDur, FMath::Max(MinDur, MaxDur));

	if (const AActor* Spot = CurrentSpot.Get())
	{
		// Точки размечены лицом к станку/прилавку/кувшину (у SO-слота — его поворот).
		RequestTurnTo(CurrentSpotYaw);

		const int32 Others = Crowd ? Crowd->GetSpotOccupancy(Spot) - 1 : 0;
		// Вдвоём-втроём на точке разговаривают охотнее.
		const float Chance = FMath::Clamp(TalkChance * TalkScale * (Others > 0 ? 1.6f : 1.f), 0.f, 1.f);
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
	// Вызов и без точки: подсистема освобождает SO-резерв, даже если маркер уже выгружен.
	if (URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		Crowd->ReleaseSpot(this, CurrentSpot.Get());
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
		if (CurrentSpot.IsValid() && FMath::Abs(FMath::FindDeltaAngleDegrees(GetActorRotation().Yaw, CurrentSpotYaw)) > 10.f)
		{
			RequestTurnTo(CurrentSpotYaw);
		}
	}
}

void ARakisCitizen::ClearLookAt()
{
	bLookAtPlayer = false;
	bHasLookAtTarget = false;
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

bool ARakisCitizen::ComputeStepAsideTarget(const APawn* Player, float DistToPlayer, float Now, FVector& OutTarget) const
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
	OutTarget = Loc + Side * StepAsideDistance + (bPlayerComing ? PathDir * 30.f : FVector::ZeroVector);
	return true;
}

bool ARakisCitizen::ShouldYieldToPlayer(const APawn* Player, float DistToPlayer, float Now) const
{
	FVector Unused;
	return ComputeStepAsideTarget(Player, DistToPlayer, Now, Unused);
}

bool ARakisCitizen::StepAsideFromPlayer(const APawn* Player, float DistToPlayer, float Now)
{
	FVector Target;
	if (!ComputeStepAsideTarget(Player, DistToPlayer, Now, Target))
	{
		return false;
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

bool ARakisCitizen::TryStepAside(const APawn* Player, float DistToPlayer, float Now)
{
	if (!ShouldYieldToPlayer(Player, DistToPlayer, Now))
	{
		return false;
	}

	// Запомнить, к чему вернуться (фоллбек; в StateTree возврат решает дерево).
	const ERakisCitizenActivity Before = Activity;
	const FVector Loc = GetActorLocation();
	switch (Before)
	{
	case ERakisCitizenActivity::UsingSpot:
		ResumeActivity = ERakisCitizenActivity::MovingToSpot;
		ResumeGoal = MoveGoal;
		break;
	case ERakisCitizenActivity::MovingToSpot:
	case ERakisCitizenActivity::Wandering:
	case ERakisCitizenActivity::RitualWalk:
		ResumeActivity = Before;
		ResumeGoal = Before == ERakisCitizenActivity::RitualWalk ? RitualGatherPoint : MoveGoal;
		break;
	default:
		ResumeActivity = ERakisCitizenActivity::Idle;
		ResumeGoal = Loc;
		break;
	}
	return StepAsideFromPlayer(Player, DistToPlayer, Now);
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
	const float Now = GetWorldNow();

	bRitualRequested = true;
	RitualGatherPoint = GatherPoint;
	if (const URakisCrowdSubsystem* Crowd = GetCrowd())
	{
		bHasHallCentre = Crowd->GetHallCentre(HallCentre);
	}
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->MaxWalkSpeed = BaseWalkSpeed * 1.05f;
	}
	NextBarkTime = FMath::Min(NextBarkTime, Now + Rng.FRandRange(2.f, 10.f));

	// Спящий (LOD Dormant) должен проснуться и пойти в зал.
	if (BehaviourLOD == ERakisCitizenLOD::Dormant)
	{
		SetLOD(ERakisCitizenLOD::Low);
	}

	if (bUsingStateTree && StateTreeComp && StateTreeComp->IsRunning())
	{
		// Дерево уходит в состояние Ritual (событие Rakis.Crowd.Event.Ritual / условие RitualRequested).
		// Не взяло за 3 с — BehaviourUpdate переводит горожанина на C++ (контракт StartRitual важнее).
		RitualStateTreeDeadline = Now + 3.f;
		StateTreeComp->SendStateTreeEvent(RakisAITags::Event_Ritual, FConstStructView(), FName(TEXT("RakisCitizen")));
		return;
	}
	BeginRitualWalk(Now);
}

void ARakisCitizen::BeginRitualWalk(float Now)
{
	SetTalking(false);
	ReleaseCurrentSpot();
	bWantsTurn = false;
	if (!bRitualRequested)
	{
		return;
	}
	if (Activity == ERakisCitizenActivity::RitualGathered && FVector::Dist2D(GetActorLocation(), RitualGatherPoint) < 200.f)
	{
		return;
	}
	Activity = ERakisCitizenActivity::RitualWalk;
	RitualRetryTime = Now + 1.f;
	MoveToPoint(RitualGatherPoint, 60.f);
}

bool ARakisCitizen::UpdateRitualWalk(float Now)
{
	if (Activity == ERakisCitizenActivity::RitualGathered)
	{
		return true;
	}
	if (Activity != ERakisCitizenActivity::RitualWalk)
	{
		BeginRitualWalk(Now);
		return false;
	}
	if (FVector::Dist2D(GetActorLocation(), RitualGatherPoint) < 200.f && IsMoveDone())
	{
		Activity = ERakisCitizenActivity::RitualGathered;
		StopMoving();
		if (bHasHallCentre)
		{
			RequestTurnTo((HallCentre - GetActorLocation()).Rotation().Yaw);
		}
		return true;
	}
	if (IsMoveDone() && Now >= RitualRetryTime)
	{
		// Путь сорвался (толкотня, частичный путь) — повторяем не чаще раза в секунду.
		RitualRetryTime = Now + 1.f;
		MoveToPoint(RitualGatherPoint, 60.f);
	}
	return false;
}

// ---------------------------------------------------------------------------------------------
// LOD / значимость
// ---------------------------------------------------------------------------------------------

void ARakisCitizen::UpdateLOD()
{
	if (RakisCitizenCtx::CVarCrowdLOD.GetValueOnGameThread() == 0)
	{
		SetLOD(ERakisCitizenLOD::Full);
		return;
	}
	float Dist = 0.f;
	if (!GetPlayerAndDistance(Dist))
	{
		return;
	}
	// Гистерезис: дальний уровень включается за порогом + H, ближний — до порога − H.
	const float LowEnter = SignificanceRadius + (BehaviourLOD == ERakisCitizenLOD::Full ? LODHysteresis : -LODHysteresis);
	const float DormantEnter = DormantRadius + (BehaviourLOD == ERakisCitizenLOD::Dormant ? -LODHysteresis : LODHysteresis);

	ERakisCitizenLOD Target = ERakisCitizenLOD::Full;
	if (Dist > DormantEnter)
	{
		Target = ERakisCitizenLOD::Dormant;
	}
	else if (Dist > LowEnter)
	{
		Target = ERakisCitizenLOD::Low;
	}
	// Путь на ритуал не засыпает: толпа должна дойти до зала, даже если игрок далеко.
	const bool bWalkingToRitual = bRitualRequested && Activity != ERakisCitizenActivity::RitualGathered;
	if (Target == ERakisCitizenLOD::Dormant && bWalkingToRitual)
	{
		Target = ERakisCitizenLOD::Low;
	}
	SetLOD(Target);
}

void ARakisCitizen::SetLOD(ERakisCitizenLOD NewLOD)
{
	if (NewLOD == BehaviourLOD)
	{
		return;
	}
	const ERakisCitizenLOD OldLOD = BehaviourLOD;
	BehaviourLOD = NewLOD;
	const bool bDormant = NewLOD == ERakisCitizenLOD::Dormant;

	if (bDormant || OldLOD == ERakisCitizenLOD::Dormant)
	{
		SetActorHiddenInGame(bDormant);
		if (UCharacterMovementComponent* Move = GetCharacterMovement())
		{
			Move->SetComponentTickEnabled(!bDormant);
		}
		if (bDormant)
		{
			bWantsTurn = false;
			SetActorTickEnabled(false);
			ClearLookAt();
		}
		if (bUsingStateTree && StateTreeComp)
		{
			if (bDormant && StateTreeComp->IsRunning())
			{
				StateTreeComp->PauseLogic(TEXT("RakisLOD.Dormant"));
			}
			else if (!bDormant && StateTreeComp->IsPaused())
			{
				StateTreeComp->ResumeLogic(TEXT("RakisLOD.Dormant"));
			}
		}
	}

	// LOD Low: StateTree тикает редко. Работает при ScheduledTickPolicy = Denied в схеме ST_Citizen (crowd.md §3.1);
	// при разрешённом scheduled tick компонент сам управляет интервалом.
	if (StateTreeComp)
	{
		StateTreeComp->SetComponentTickInterval(NewLOD == ERakisCitizenLOD::Low ? LowLODTickInterval : 0.f);
	}
}
