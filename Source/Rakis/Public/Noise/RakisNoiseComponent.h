#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/RakisTypes.h"
#include "RakisNoiseComponent.generated.h"

/** Походка игрока — определяет базовую громкость шага. */
UENUM(BlueprintType)
enum class ERakisGait : uint8
{
	Walk		UMETA(DisplayName = "Walk"),
	Run			UMETA(DisplayName = "Run"),
	SandWalk	UMETA(DisplayName = "Sand Walk")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnNoiseChanged, float, Noise01);

/**
 * Персональный метр шума игрока (для HUD «шумовой ряби») + отправка событий в URakisNoiseSubsystem.
 * Метр растёт от шагов и спадает DecayPerSecond по таймеру (без Tick).
 */
UCLASS(ClassGroup = (Rakis), meta = (BlueprintSpawnableComponent))
class RAKIS_API URakisNoiseComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	URakisNoiseComponent();

	/** Текущий уровень персонального шума 0..1. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Noise")
	float GetNoise01() const { return Noise01; }

	/** Добавить шум: поднимает метр и регистрирует событие в мире в позиции владельца. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Noise")
	void AddNoise(float Loudness, FName Source);

	/** То же, но с явной позицией события (например, позиция стопы). */
	void AddNoiseAt(float Loudness, FName Source, const FVector& Location);

	/** Громкость шага с учётом походки, поверхности и регулярности ритма (по URakisNoiseTuning). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Noise")
	float ComputeFootstepLoudness(ERakisGait Gait, ERakisSurface Surface, float Regularity) const;

	/** Чистая формула: Base * SurfaceMult * (1 + RhythmPenalty * Regularity). */
	static float ComputeStepLoudness(float BaseLoudness, float SurfaceMultiplier, float Regularity, float RhythmPenalty);

	/** Чистая формула спада: max(0, Value - DecayPerSecond * DeltaSeconds). */
	static float ComputeDecayed(float Value, float DecayPerSecond, float DeltaSeconds);

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Noise")
	FOnNoiseChanged OnNoiseChanged;

protected:
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Период шага спада, с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Noise", meta = (ClampMin = "0.02"))
	float DecayInterval = 0.1f;

	/** Отправлять ли события в URakisNoiseSubsystem (выключить для NPC-«болтунов»). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Noise")
	bool bReportToWorld = true;

private:
	void StartDecay();
	void DecayStep();
	void SetNoise(float NewValue);

	float Noise01 = 0.f;
	float LastDecayTime = 0.f;
	FTimerHandle DecayTimer;
};
