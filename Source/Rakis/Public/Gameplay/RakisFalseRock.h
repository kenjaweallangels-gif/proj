#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/RakisInteractable.h"
#include "Engine/TimerHandle.h"
#include "RakisFalseRock.generated.h"

class UStaticMeshComponent;
class UStaticMesh;
class UNiagaraSystem;
class USoundBase;

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnFalseRockEvent);

/**
 * Фальшивый камень входа A4: каменная плита, которая один раз отъезжает в сторону,
 * открывая расщелину в сиетч. Пыль/камешки (NS_Rock_Hop) и скрежет — на старте движения.
 * Открыть: взаимодействие игрока или Open() из StoryDirector.
 */
UCLASS()
class RAKIS_API ARakisFalseRock : public AActor, public IRakisInteractable
{
	GENERATED_BODY()

public:
	ARakisFalseRock();

	// IRakisInteractable
	virtual FText GetInteractVerb() const override { return InteractVerb; }
	virtual bool CanInteract(ARakisCharacter* Interactor) const override { return !bLocked && !bOpened && !bMoving; }
	virtual void Interact(ARakisCharacter* Interactor) override { Open(); }

	/** Открыть (одноразово). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|FalseRock")
	void Open();

	UFUNCTION(BlueprintPure, Category = "Rakis|FalseRock")
	bool IsOpened() const { return bOpened; }

	UFUNCTION(BlueprintCallable, Category = "Rakis|FalseRock")
	void SetLocked(bool bInLocked) { bLocked = bInLocked; }

	/** Плита тронулась. */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|FalseRock")
	FOnFalseRockEvent OnStartedOpening;

	/** Плита встала, проход открыт. */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|FalseRock")
	FOnFalseRockEvent OnOpened;

protected:
	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|FalseRock")
	TObjectPtr<USceneComponent> SceneRoot;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|FalseRock")
	TObjectPtr<UStaticMeshComponent> Slab;

	/** Заперт до сюжетного бита (экземпляр). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|FalseRock")
	bool bLocked = false;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock|Assets")
	TSoftObjectPtr<UStaticMesh> SlabMeshAsset;

	/** Размер плиты-фоллбека, см (толщина, ширина, высота). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock")
	FVector FallbackSlabSize = FVector(80.f, 420.f, 380.f);

	/** Смещение плиты в открытом положении (локально). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock")
	FVector OpenOffset = FVector(-40.f, -400.f, 0.f);

	/** Доворот плиты в открытом положении. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock")
	FRotator OpenRotation = FRotator(0.f, -6.f, 0.f);

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock", meta = (ClampMin = "0.1"))
	float OpenTime = 3.5f;

	/** Пауза между «щелчком» механизма и движением, с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock", meta = (ClampMin = "0"))
	float StartDelay = 0.4f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock|Assets")
	TSoftObjectPtr<UNiagaraSystem> DustFX;

	/** Скрежет камня (необязателен). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock|Assets")
	TSoftObjectPtr<USoundBase> GrindSound;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|FalseRock")
	FText InteractVerb;

private:
	void BeginMove();
	void MoveStep();
	void ApplyAlpha(float InAlpha);

	UPROPERTY()
	TObjectPtr<UStaticMesh> FallbackCubeMesh;

	FTransform ClosedRelative;
	float Alpha = 0.f;
	float LastStepTime = 0.f;
	bool bOpened = false;
	bool bMoving = false;

	FTimerHandle MoveTimer;
};
