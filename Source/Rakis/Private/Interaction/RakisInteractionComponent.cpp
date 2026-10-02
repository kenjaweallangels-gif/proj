#include "Interaction/RakisInteractionComponent.h"

#include "Engine/World.h"
#include "GameFramework/Controller.h"
#include "Interaction/RakisInteractable.h"
#include "Player/RakisCharacter.h"
#include "TimerManager.h"

URakisInteractionComponent::URakisInteractionComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void URakisInteractionComponent::BeginPlay()
{
	Super::BeginPlay();
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(UpdateTimer, this, &URakisInteractionComponent::UpdateFocus,
			1.f / FMath::Max(1.f, UpdateHz), true);
	}
}

void URakisInteractionComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(UpdateTimer);
	}
	Super::EndPlay(EndPlayReason);
}

ARakisCharacter* URakisInteractionComponent::GetOwnerCharacter() const
{
	return Cast<ARakisCharacter>(GetOwner());
}

void URakisInteractionComponent::SetInteractionEnabled(bool bInEnabled)
{
	bEnabled = bInEnabled;
	if (!bEnabled)
	{
		SetFocus(nullptr);
	}
}

void URakisInteractionComponent::UpdateFocus()
{
	ARakisCharacter* Character = GetOwnerCharacter();
	UWorld* World = GetWorld();
	if (!bEnabled || !Character || !World || !Character->IsPlayerControlled() || Character->IsInputLocked())
	{
		SetFocus(nullptr);
		return;
	}

	// Точка обзора камеры (в 3-м лице камера за спиной — дальность считаем от игрока).
	FVector ViewLocation;
	FRotator ViewRotation;
	Character->GetController()->GetPlayerViewPoint(ViewLocation, ViewRotation);
	const FVector Dir = ViewRotation.Vector();
	const FVector PawnEye = Character->GetPawnViewLocation();
	const float CameraToPawn = FMath::Max(0.f, FVector::DotProduct(PawnEye - ViewLocation, Dir));

	const FVector Start = ViewLocation + Dir * CameraToPawn * 0.5f;
	const FVector End = ViewLocation + Dir * (CameraToPawn + Reach);

	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisInteractTrace), false, Character);
	FHitResult Hit;
	AActor* Candidate = nullptr;
	if (World->SweepSingleByChannel(Hit, Start, End, FQuat::Identity, TraceChannel, FCollisionShape::MakeSphere(SweepRadius), Params))
	{
		AActor* HitActor = Hit.GetActor();
		if (HitActor && FVector::Dist(HitActor->GetActorLocation(), PawnEye) <= Reach + 300.f
			&& FVector::Dist(Hit.ImpactPoint, PawnEye) <= Reach + 50.f)
		{
			if (const IRakisInteractable* Interactable = Cast<IRakisInteractable>(HitActor))
			{
				if (Interactable->CanInteract(Character))
				{
					Candidate = HitActor;
				}
			}
		}
	}
	SetFocus(Candidate);
}

void URakisInteractionComponent::SetFocus(AActor* NewFocus)
{
	FText NewVerb;
	if (const IRakisInteractable* Interactable = Cast<IRakisInteractable>(NewFocus))
	{
		NewVerb = Interactable->GetInteractVerb();
	}

	if (Focused.Get() != NewFocus || !NewVerb.EqualTo(FocusedVerb))
	{
		Focused = NewFocus;
		FocusedVerb = NewVerb;
		OnFocusChanged.Broadcast(NewFocus, NewVerb);
	}
}

bool URakisInteractionComponent::TryInteract()
{
	ARakisCharacter* Character = GetOwnerCharacter();
	AActor* Target = Focused.Get();
	if (!bEnabled || !Character || !Target)
	{
		return false;
	}

	IRakisInteractable* Interactable = Cast<IRakisInteractable>(Target);
	if (!Interactable || !Interactable->CanInteract(Character))
	{
		return false;
	}

	Interactable->Interact(Character);
	OnInteracted.Broadcast(Target);
	// Состояние объекта могло измениться (дверь открылась) — обновить подсказку сразу.
	UpdateFocus();
	return true;
}
