#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/RakisInteractable.h"
#include "RakisThumper.generated.h"

class UStaticMeshComponent;
class UStaticMesh;
class UNiagaraSystem;
class USoundBase;

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnThumperPulse);

/**
 * Тампер — кол с колотушкой. Игрок вбивает его в песок (T / Y); каждые ThumperInterval
 * он «бьёт» → URakisNoiseSubsystem::ReportNoise(Source = "Thumper", Loudness = ThumperLoudness),
 * червь взвешивает такой шум с ThumperWeight. Работает Lifetime секунд, затем замолкает;
 * в любой момент его можно забрать (IRakisInteractable → +1 заряд игроку).
 */
UCLASS()
class RAKIS_API ARakisThumper : public AActor, public IRakisInteractable
{
	GENERATED_BODY()

public:
	ARakisThumper();

	// IRakisInteractable
	virtual FText GetInteractVerb() const override { return InteractVerb; }
	virtual bool CanInteract(ARakisCharacter* Instigator) const override { return Instigator != nullptr; }
	virtual void Interact(ARakisCharacter* Instigator) override;

	UFUNCTION(BlueprintPure, Category = "Rakis|Thumper")
	bool IsThumping() const { return bThumping; }

	/** Запустить удары (по умолчанию — сразу после появления). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Thumper")
	void StartThumping();

	UFUNCTION(BlueprintCallable, Category = "Rakis|Thumper")
	void StopThumping();

	/** Каждый удар (анимация колотушки в BP, звук-директор). */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|Thumper")
	FOnThumperPulse OnPulse;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Thumper")
	TObjectPtr<UStaticMeshComponent> StakeMesh;

	/** Меш тампера (необязателен: без него — цилиндр-кол). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper")
	TSoftObjectPtr<UStaticMesh> StakeMeshAsset;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper")
	TSoftObjectPtr<UNiagaraSystem> PulseFX;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper")
	TSoftObjectPtr<USoundBase> PulseSound;

	/** Сколько секунд тампер бьёт. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper", meta = (ClampMin = "1"))
	float Lifetime = 30.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper")
	bool bStartThumpingOnSpawn = true;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Thumper")
	FText InteractVerb;

private:
	void Pulse();

	UPROPERTY()
	TObjectPtr<UStaticMesh> FallbackStakeMesh;

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraSystem> LoadedPulseFX;

	UPROPERTY(Transient)
	TObjectPtr<USoundBase> LoadedPulseSound;

	bool bThumping = false;
	FTimerHandle PulseTimer;
	FTimerHandle LifetimeTimer;
};
