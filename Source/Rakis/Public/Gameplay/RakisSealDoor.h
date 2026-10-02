#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/RakisInteractable.h"
#include "Engine/TimerHandle.h"
#include "RakisSealDoor.generated.h"

class UBoxComponent;
class UStaticMeshComponent;
class UStaticMesh;
class UNiagaraSystem;
class USoundBase;

/** Как двигаются створки. */
UENUM(BlueprintType)
enum class ERakisDoorMotion : uint8
{
	Slide	UMETA(DisplayName = "Slide apart"),
	Rotate	UMETA(DisplayName = "Swing on hinges")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSealDoorMoved, bool, bOpening);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSealDoorSealed, bool, bSealed);

/**
 * Дверь-уплотнитель сиетча: две створки (раздвижные или на петлях), шипение (MS_SealDoor),
 * пар-конденсат (NS_SealDoor_Steam) при открытии и при запечатывании, автозакрытие,
 * пока в проёме никого нет. Анимация — таймер только на время движения.
 * Локальные оси: X — нормаль проёма, Y — ширина, Z — вверх; основание в точке актора.
 */
UCLASS()
class RAKIS_API ARakisSealDoor : public AActor, public IRakisInteractable
{
	GENERATED_BODY()

public:
	ARakisSealDoor();

	// IRakisInteractable
	virtual FText GetInteractVerb() const override;
	virtual bool CanInteract(ARakisCharacter* Interactor) const override;
	virtual void Interact(ARakisCharacter* Interactor) override;

	UFUNCTION(BlueprintCallable, Category = "Rakis|Door") void Open();
	UFUNCTION(BlueprintCallable, Category = "Rakis|Door") void Close();
	UFUNCTION(BlueprintCallable, Category = "Rakis|Door") void Toggle();

	/** Целевое состояние — открыто (в т.ч. во время открывания). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Door") bool IsOpen() const { return bTargetOpen; }

	/** Полностью закрыта и запечатана. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Door") bool IsSealed() const { return bSealed; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Door") bool IsMoving() const { return bMoving; }

	/** Заперта сюжетом (стража ещё не пропустила). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Door") void SetLocked(bool bInLocked) { bLocked = bInLocked; }

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Door")
	FOnSealDoorMoved OnDoorMoved;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Door")
	FOnSealDoorSealed OnSealedChanged;

protected:
	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Door") TObjectPtr<USceneComponent> SceneRoot;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Door") TObjectPtr<USceneComponent> LeftHinge;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Door") TObjectPtr<USceneComponent> RightHinge;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Door") TObjectPtr<UStaticMeshComponent> LeftPanel;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Door") TObjectPtr<UStaticMeshComponent> RightPanel;
	/** Проём: ловит трассу "Interact" (закрыть открытую дверь) и перекрытия пешек (не закрывать на людях). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Door") TObjectPtr<UBoxComponent> Doorway;

	/** Заперта на старте (экземпляр). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Door")
	bool bLocked = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Door")
	bool bStartOpen = false;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door")
	ERakisDoorMotion Motion = ERakisDoorMotion::Slide;

	/** Размер одной створки, см (толщина, ширина, высота). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door")
	FVector PanelSize = FVector(24.f, 110.f, 250.f);

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door", meta = (ClampMin = "0"))
	float SlideDistance = 105.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door", meta = (ClampMin = "0", ClampMax = "170"))
	float SwingAngle = 95.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door", meta = (ClampMin = "0.05"))
	float OpenTime = 1.6f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door", meta = (ClampMin = "0.05"))
	float CloseTime = 2.2f;

	/** Автозакрытие через N секунд после открытия (0 — нет). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door", meta = (ClampMin = "0"))
	float AutoCloseDelay = 5.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door|Assets")
	TSoftObjectPtr<UStaticMesh> PanelMeshAsset;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door|Assets")
	TSoftObjectPtr<UNiagaraSystem> SteamFX;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door|Assets")
	TSoftObjectPtr<USoundBase> HissSound;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door")
	FText OpenVerb;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Door")
	FText CloseVerb;

private:
	void StartMotion(bool bOpen);
	void MotionStep();
	void ApplyAlpha(float InAlpha);
	void TryAutoClose();
	void PlayHissAndSteam(float Intensity);
	void SetupPanels();

	UPROPERTY()
	TObjectPtr<UStaticMesh> FallbackCubeMesh;

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraSystem> LoadedSteamFX;

	UPROPERTY(Transient)
	TObjectPtr<USoundBase> LoadedHissSound;

	bool bUsingFallbackPanel = true;
	FVector PanelMeshSize = FVector(100.f);

	float Alpha = 0.f;           // 0 — закрыто, 1 — открыто
	bool bTargetOpen = false;
	bool bMoving = false;
	bool bSealed = true;
	float LastStepTime = 0.f;

	FTimerHandle MotionTimer;
	FTimerHandle AutoCloseTimer;
};
