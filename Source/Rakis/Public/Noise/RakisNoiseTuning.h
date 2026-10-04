#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Core/RakisTypes.h"
#include "RakisNoiseTuning.generated.h"

/**
 * Параметры шума шагов и тампера (контракт §2.6, источник — docs/design/mechanics.md).
 * Ассет: /Game/Rakis/Data/DA_NoiseTuning. Если ассета нет — используется CDO с дефолтами ниже.
 */
UCLASS(BlueprintType)
class RAKIS_API URakisNoiseTuning : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	URakisNoiseTuning();

	/** DA из URakisSettings, при отсутствии — CDO (никогда не nullptr). */
	static const URakisNoiseTuning* Get();

	/** Множитель поверхности; для поверхностей без записи в карте — 1.0. */
	float GetSurfaceMultiplier(ERakisSurface Surface) const;

	// --- Контракт §2.6 ---

	/** Громкость шага обычной ходьбы (0..1). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0"))
	float WalkLoudness = 0.35f;

	/** Громкость шага бега. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0"))
	float RunLoudness = 0.80f;

	/** Громкость шага «походки по песку». */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0"))
	float SandWalkLoudness = 0.12f;

	/** Множитель за регулярность ритма: Loudness *= 1 + RhythmPenalty * Regularity. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0"))
	float RhythmPenalty = 0.6f;

	/** Множители поверхности: Sand 1.0, PackedSand 1.4, Rock 0.0, SietchStone 0.0 (+ Cloth/Metal для сиетча). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise")
	TMap<ERakisSurface, float> SurfaceMultiplier;

	/** Спад персонального метра шума, единиц в секунду. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0"))
	float DecayPerSecond = 0.15f;

	/** Окно оценки ритма (интервалов между шагами). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "2", ClampMax = "32"))
	int32 RegularityWindow = 6;

	/** Громкость одного удара тампера. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0"))
	float ThumperLoudness = 1.0f;

	/** Период ударов тампера, с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise", meta = (ClampMin = "0.1"))
	float ThumperInterval = 1.6f;

	// --- Расширение (не в контракте, но тоже данные) ---

	/** Сколько громкости шага попадает в персональный метр (метр = сумма шагов * gain − спад). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "0"))
	float MeterGainPerStep = 0.2f;

	/** Коэффициент вариации интервалов, при котором ритм считается полностью хаотичным (регулярность 0). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "0.01"))
	float RhythmCVReference = 0.35f;

	/** Пауза между шагами, после которой ритм начинается заново (история интервалов сбрасывается), с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "0.2"))
	float RhythmResetGap = 1.5f;

	/** Постоянная времени затухания события шума в мире (exp(-age/Tau)), с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "0.05"))
	float EventMemoryTau = 2.0f;

	/** События старше этого возраста игнорируются, с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "0.1"))
	float EventMaxAge = 10.0f;

	/** Нормировка суммы событий в SampleNoise (ровная ходьба рядом ≈ 0.5). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "0"))
	float SampleScale = 0.25f;

	/** Ёмкость кольцевого буфера событий шума в URakisNoiseSubsystem. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Noise|Advanced", meta = (ClampMin = "16", ClampMax = "4096"))
	int32 EventBufferSize = 256;
};
