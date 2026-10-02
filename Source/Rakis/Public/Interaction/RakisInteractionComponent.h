#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Engine/EngineTypes.h"
#include "RakisInteractionComponent.generated.h"

class ARakisCharacter;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnFocusChanged, AActor*, Actor, FText, Verb);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnInteracted, AActor*, Actor);

/**
 * Поиск объекта взаимодействия: сфера-трасса из камеры на 250 см (от игрока) по таймеру 10 Гц.
 * Канал трассы — "Interact" (ECC_GameTraceChannel1, Config/DefaultEngine.ini).
 */
UCLASS(ClassGroup = (Rakis), meta = (BlueprintSpawnableComponent))
class RAKIS_API URakisInteractionComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	URakisInteractionComponent();

	/** Объект в фокусе (реализует IRakisInteractable и CanInteract == true) или nullptr. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Interaction")
	AActor* GetFocused() const { return Focused.Get(); }

	/** Слово-глагол текущего фокуса. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Interaction")
	FText GetFocusedVerb() const { return FocusedVerb; }

	/** Взаимодействовать с объектом в фокусе. true — успешно. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Interaction")
	bool TryInteract();

	/** Включить/выключить поиск (кат-сцены). При выключении фокус сбрасывается. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Interaction")
	void SetInteractionEnabled(bool bInEnabled);

	/** Смена фокуса; Actor = nullptr и пустой Verb — фокуса нет. */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|Interaction")
	FOnFocusChanged OnFocusChanged;

	/** Успешное взаимодействие (StoryDirector: триггер Interact:<ActorTag>). */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|Interaction")
	FOnInteracted OnInteracted;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Дальность от игрока, см (контракт: 250). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Interaction", meta = (ClampMin = "10"))
	float Reach = 250.f;

	/** Радиус сферы трассы, см. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Interaction", meta = (ClampMin = "0"))
	float SweepRadius = 18.f;

	/** Частота поиска, Гц. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Interaction", meta = (ClampMin = "1", ClampMax = "60"))
	float UpdateHz = 10.f;

	/** Канал трассы. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Interaction")
	TEnumAsByte<ECollisionChannel> TraceChannel = ECC_GameTraceChannel1;

private:
	void UpdateFocus();
	void SetFocus(AActor* NewFocus);
	ARakisCharacter* GetOwnerCharacter() const;

	TWeakObjectPtr<AActor> Focused;
	FText FocusedVerb;
	bool bInteractionEnabled = true;
	FTimerHandle UpdateTimer;
};
