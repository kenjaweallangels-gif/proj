#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "RakisHydrationTuning.generated.h"

/**
 * Параметры влаги и жары (контракт §2.6). Ассет: /Game/Rakis/Data/DA_HydrationTuning.
 * Скорости — доля шкалы влаги (0..1) в минуту.
 */
UCLASS(BlueprintType)
class RAKIS_API URakisHydrationTuning : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	/** DA из URakisSettings, при отсутствии — CDO (никогда не nullptr). */
	static const URakisHydrationTuning* Get();

	// --- Контракт §2.6 ---

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration", meta = (ClampMin = "0"))
	float SunDrainPerMinute = 0.06f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration", meta = (ClampMin = "0"))
	float ShadeRecoverPerMinute = 0.02f;

	/** Множитель расхода при беге. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration", meta = (ClampMin = "0"))
	float RunMultiplier = 2.0f;

	/** Множитель расхода при закрытой маске дистикомба. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration", meta = (ClampMin = "0"))
	float MaskSealedFactor = 0.35f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration", meta = (ClampMin = "0"))
	float InteriorRecoverPerMinute = 0.05f;

	// --- Расширение ---

	/** Стартовая влага. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0", ClampMax = "1"))
	float InitialMoisture = 0.9f;

	/** Период проверки солнца/тени, с (контракт: 0.25). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0.05"))
	float UpdateInterval = 0.25f;

	/** Длина трассы к солнцу, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "100"))
	float SunTraceLength = 200000.f;

	/** Скорость, с которой Heat01 следует за целевой жарой (доля в секунду). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0"))
	float HeatResponsePerSecond = 0.08f;

	/** Целевая жара на солнце / в тени / внутри (0..1). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0", ClampMax = "1"))
	float HeatInSun = 1.0f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0", ClampMax = "1"))
	float HeatInShade = 0.4f;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0", ClampMax = "1"))
	float HeatInterior = 0.1f;

	/** Минимальное изменение влаги, после которого шлётся OnMoistureChanged. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Hydration|Advanced", meta = (ClampMin = "0"))
	float BroadcastEpsilon = 0.002f;
};
