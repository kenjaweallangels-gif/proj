#include "AI/RakisCitizenStateTree.h"

#include "AI/RakisCitizen.h"
#include "World/RakisZoneSubsystem.h"

#include "Components/ActorComponent.h"
#include "GameFramework/Controller.h"
#include "GameFramework/Pawn.h"
#include "StateTreeExecutionContext.h"

namespace RakisCitizenST
{
	/** Горожанин из владельца StateTree: сам актор, пешка контроллера или владелец компонента. */
	static ARakisCitizen* GetCitizen(FStateTreeExecutionContext& Context)
	{
		UObject* Owner = Context.GetOwner();
		if (ARakisCitizen* Citizen = Cast<ARakisCitizen>(Owner))
		{
			return Citizen;
		}
		if (const AController* Controller = Cast<AController>(Owner))
		{
			return Cast<ARakisCitizen>(Controller->GetPawn());
		}
		if (const UActorComponent* Component = Cast<UActorComponent>(Owner))
		{
			return Cast<ARakisCitizen>(Component->GetOwner());
		}
		return nullptr;
	}
}

// =============================================================================================
// Evaluator
// =============================================================================================

void FRakisSTEval_CitizenSense::TreeStart(FStateTreeExecutionContext& Context) const
{
	Tick(Context, 0.f);
}

void FRakisSTEval_CitizenSense::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	Data.Citizen = Citizen;
	if (!Citizen)
	{
		Data.bHasPlayer = false;
		return;
	}

	float Dist = 0.f;
	const APawn* Player = Citizen->GetPlayerAndDistance(Dist);
	Data.bHasPlayer = Player != nullptr;
	Data.PlayerDistance = Player ? Dist : 1.0e9f;
	Data.PlayerLocation = Player ? Player->GetActorLocation() : FVector::ZeroVector;
	Data.bPlayerNear = Player && Dist <= Citizen->LookAtRadius;
	Data.bPlayerBlocking = Citizen->ShouldYieldToPlayer(Player, Dist, Citizen->GetWorldNow());

	const URakisZoneSubsystem* Zones = URakisZoneSubsystem::Get(Citizen);
	Data.PlayerZone = Zones ? Zones->GetPlayerZone() : ERakisZone::None;

	Data.bRitualRequested = Citizen->IsRitualRequested();
	Data.bIsTalking = Citizen->bIsTalking;
	Data.Activity = Citizen->Activity;
	Data.LOD = Citizen->GetBehaviourLOD();
}

// =============================================================================================
// Conditions
// =============================================================================================

bool FRakisSTCond_RitualRequested::TestCondition(FStateTreeExecutionContext& Context) const
{
	const ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	const bool bResult = Citizen && Citizen->IsRitualRequested();
	return bResult != bInvert;
}

bool FRakisSTCond_ShouldYieldToPlayer::TestCondition(FStateTreeExecutionContext& Context) const
{
	const ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	bool bResult = false;
	if (Citizen)
	{
		float Dist = 0.f;
		const APawn* Player = Citizen->GetPlayerAndDistance(Dist);
		bResult = Citizen->ShouldYieldToPlayer(Player, Dist, Citizen->GetWorldNow());
	}
	return bResult != bInvert;
}

// =============================================================================================
// Wander
// =============================================================================================

EStateTreeRunStatus FRakisSTTask_Wander::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	const FInstanceDataType& Data = Context.GetInstanceData(*this);
	return Citizen->StartWander(Data.Radius) ? EStateTreeRunStatus::Running : EStateTreeRunStatus::Failed;
}

EStateTreeRunStatus FRakisSTTask_Wander::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen || Citizen->Activity != ERakisCitizenActivity::Wandering)
	{
		return EStateTreeRunStatus::Failed;
	}
	if (Citizen->IsMoveFinished())
	{
		Citizen->StopMoving();
		Citizen->SetActivity(ERakisCitizenActivity::Idle);
		return EStateTreeRunStatus::Succeeded;
	}
	return EStateTreeRunStatus::Running;
}

void FRakisSTTask_Wander::ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (Citizen && Citizen->Activity == ERakisCitizenActivity::Wandering)
	{
		Citizen->StopMoving();
		Citizen->SetActivity(ERakisCitizenActivity::Idle);
	}
}

// =============================================================================================
// Idle
// =============================================================================================

EStateTreeRunStatus FRakisSTTask_Idle::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	const FInstanceDataType& Data = Context.GetInstanceData(*this);
	const float MinDur = Data.DurationMin > 0.f ? Data.DurationMin : Citizen->WanderIdleMin;
	const float MaxDur = Data.DurationMax > 0.f ? Data.DurationMax : Citizen->WanderIdleMax;
	Citizen->BeginIdle(FMath::FRandRange(MinDur, FMath::Max(MinDur, MaxDur)));
	return EStateTreeRunStatus::Running;
}

EStateTreeRunStatus FRakisSTTask_Idle::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	const ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen || Citizen->Activity != ERakisCitizenActivity::Idle)
	{
		return EStateTreeRunStatus::Succeeded;
	}
	return Citizen->GetWorldNow() >= Citizen->GetActivityEndTime() ? EStateTreeRunStatus::Succeeded : EStateTreeRunStatus::Running;
}

// =============================================================================================
// FindAndUseSmartObject
// =============================================================================================

EStateTreeRunStatus FRakisSTTask_FindAndUseSmartObject::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	Data.Phase = 0;
	Data.SpotType = NAME_None;
	if (!Citizen->ClaimSpotAndMove(Data.SearchRadius))
	{
		return EStateTreeRunStatus::Failed;
	}
	Data.SpotType = Citizen->CurrentSpotType;
	return EStateTreeRunStatus::Running;
}

EStateTreeRunStatus FRakisSTTask_FindAndUseSmartObject::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	const float Now = Citizen->GetWorldNow();

	if (Data.Phase == 0)
	{
		if (Citizen->Activity != ERakisCitizenActivity::MovingToSpot || !Citizen->GetCurrentSpot())
		{
			return EStateTreeRunStatus::Failed;
		}
		if (!Citizen->IsMoveFinished())
		{
			return EStateTreeRunStatus::Running;
		}
		if (!Citizen->IsAtMoveGoal())
		{
			return EStateTreeRunStatus::Failed;
		}
		Citizen->ArriveAtSpot(Now, Data.UseDurationMin, Data.UseDurationMax);
		Data.Phase = 1;
		return EStateTreeRunStatus::Running;
	}

	if (Citizen->Activity != ERakisCitizenActivity::UsingSpot)
	{
		return EStateTreeRunStatus::Failed;
	}
	return Now >= Citizen->GetActivityEndTime() ? EStateTreeRunStatus::Succeeded : EStateTreeRunStatus::Running;
}

void FRakisSTTask_FindAndUseSmartObject::ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	if (ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context))
	{
		// Освобождение слота SO (MarkSlotAsFree) и тишина — при любом выходе: успех, провал, прерывание.
		Citizen->LeaveSpot();
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	Data.Phase = 0;
}

// =============================================================================================
// LookAtPlayer
// =============================================================================================

FRakisSTTask_LookAtPlayer::FRakisSTTask_LookAtPlayer()
{
	// Бесконечная фоновая задача — не должна держать состояние от завершения.
	bConsideredForCompletion = false;
}

EStateTreeRunStatus FRakisSTTask_LookAtPlayer::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	return Tick(Context, 0.f);
}

EStateTreeRunStatus FRakisSTTask_LookAtPlayer::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	if (ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context))
	{
		float Dist = 0.f;
		const APawn* Player = Citizen->GetPlayerAndDistance(Dist);
		Citizen->UpdateLookAt(Player, Dist);
	}
	return EStateTreeRunStatus::Running;
}

void FRakisSTTask_LookAtPlayer::ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	if (ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context))
	{
		Citizen->ClearLookAt();
	}
}

// =============================================================================================
// YieldToPlayer
// =============================================================================================

EStateTreeRunStatus FRakisSTTask_YieldToPlayer::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	float Dist = 0.f;
	const APawn* Player = Citizen->GetPlayerAndDistance(Dist);
	return Citizen->StepAsideFromPlayer(Player, Dist, Citizen->GetWorldNow()) ? EStateTreeRunStatus::Running : EStateTreeRunStatus::Failed;
}

EStateTreeRunStatus FRakisSTTask_YieldToPlayer::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	const ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen || Citizen->Activity != ERakisCitizenActivity::SteppingAside)
	{
		return EStateTreeRunStatus::Succeeded;
	}
	const bool bDone = Citizen->IsMoveFinished() || Citizen->GetWorldNow() > Citizen->GetActivityEndTime();
	return bDone ? EStateTreeRunStatus::Succeeded : EStateTreeRunStatus::Running;
}

void FRakisSTTask_YieldToPlayer::ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (Citizen && Citizen->Activity == ERakisCitizenActivity::SteppingAside)
	{
		Citizen->StopMoving();
		Citizen->SetActivity(ERakisCitizenActivity::Idle);
	}
}

// =============================================================================================
// FallSilent
// =============================================================================================

FRakisSTTask_FallSilent::FRakisSTTask_FallSilent()
{
	bConsideredForCompletion = false;
}

EStateTreeRunStatus FRakisSTTask_FallSilent::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	Data.ClearSince = -1.f;
	Citizen->SetSilenceDrivenByStateTree(true);
	return EStateTreeRunStatus::Running;
}

EStateTreeRunStatus FRakisSTTask_FallSilent::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Running;
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	if (!Citizen->bIsTalking)
	{
		Data.ClearSince = -1.f;
		return EStateTreeRunStatus::Running;
	}

	float Dist = 0.f;
	Citizen->GetPlayerAndDistance(Dist);
	const float Now = Citizen->GetWorldNow();
	if (Dist < Data.SilenceRadius)
	{
		Citizen->SetConversationSilenced(true);
		Data.ClearSince = -1.f;
	}
	else if (Citizen->bConversationSilenced && Dist > Data.ResumeRadius)
	{
		if (Data.ClearSince < 0.f)
		{
			Data.ClearSince = Now;
		}
		else if (Now - Data.ClearSince >= Data.ResumeDelay)
		{
			Citizen->SetConversationSilenced(false);
			Data.ClearSince = -1.f;
		}
	}
	else
	{
		Data.ClearSince = -1.f;
	}
	return EStateTreeRunStatus::Running;
}

void FRakisSTTask_FallSilent::ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	if (ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context))
	{
		Citizen->SetConversationSilenced(false);
		Citizen->SetSilenceDrivenByStateTree(false);
	}
}

// =============================================================================================
// GoToRitual
// =============================================================================================

EStateTreeRunStatus FRakisSTTask_GoToRitual::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen || !Citizen->IsRitualRequested())
	{
		return EStateTreeRunStatus::Failed;
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	Citizen->BeginRitualWalk(Citizen->GetWorldNow());
	Data.bGathered = Citizen->Activity == ERakisCitizenActivity::RitualGathered;
	return EStateTreeRunStatus::Running;
}

EStateTreeRunStatus FRakisSTTask_GoToRitual::Tick(FStateTreeExecutionContext& Context, const float DeltaTime) const
{
	ARakisCitizen* Citizen = RakisCitizenST::GetCitizen(Context);
	if (!Citizen)
	{
		return EStateTreeRunStatus::Failed;
	}
	FInstanceDataType& Data = Context.GetInstanceData(*this);
	// Шаг в сторону (YieldToPlayer внутри Ritual) меняет Activity — UpdateRitualWalk сам вернёт на путь.
	if (Citizen->Activity != ERakisCitizenActivity::SteppingAside)
	{
		Data.bGathered = Citizen->UpdateRitualWalk(Citizen->GetWorldNow());
	}
	return EStateTreeRunStatus::Running;
}
