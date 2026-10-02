#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "RakisWormTuning.generated.h"

/**
 * Параметры червя (контракт §2.6). Ассет: /Game/Rakis/Data/DA_WormTuning.
 * Все расстояния — в сантиметрах, скорости — см/с, времена — секунды.
 */
UCLASS(BlueprintType)
class RAKIS_API URakisWormTuning : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	/** DA из URakisSettings, при отсутствии — CDO (никогда не nullptr). */
	static const URakisWormTuning* Get();

	// --- Контракт §2.6 ---

	/** Радиус слуха червя, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Senses", meta = (ClampMin = "1000"))
	float HearingRadius = 120000.f;

	/** Порог шума Dormant → Listening. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Senses", meta = (ClampMin = "0"))
	float ListenThreshold = 0.25f;

	/** Порог шума Listening → Approach. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Senses", meta = (ClampMin = "0"))
	float ApproachThreshold = 0.55f;

	/** Сколько червь «слушает» тишину, прежде чем потерять интерес (Listening → Dormant, Approach → Pass), с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Timing", meta = (ClampMin = "0.5"))
	float ListenTime = 6.f;

	/** Длительность ухода (Pass): проход мимо и погружение, с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Timing", meta = (ClampMin = "1"))
	float PassTime = 14.f;

	/** После ухода червь глух столько секунд. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Timing", meta = (ClampMin = "0"))
	float DormantCooldown = 45.f;

	/** Скорость подхода под песком, см/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float ApproachSpeed = 2500.f;

	/** Скорость над поверхностью (выход, проход, езда), см/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float SurfaceSpeed = 1800.f;

	/** Длина тела, см (360 м). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "1000"))
	float Length = 36000.f;

	/** Диаметр тела, см (40 м). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "100"))
	float Diameter = 4000.f;

	/** Число колец-сегментов (инстансов). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "4", ClampMax = "512"))
	int32 SegmentCount = 90;

	/** Высота подъёма головы над песком при выходе, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float SurfaceHeight = 5000.f;

	/** Глубина покоя (центр головы под поверхностью), см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float BurrowDepth = 6000.f;

	/** Игрок на камне (Rock/SietchStone) не является целью. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Senses")
	bool RockIsSafe = true;

	/** Вес шума тампера относительно шагов. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Senses", meta = (ClampMin = "0"))
	float ThumperWeight = 2.0f;

	// --- Расширение ---

	/** Дистанция головы до цели (по горизонтали), на которой Approach переходит в Surface/Pass, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Senses", meta = (ClampMin = "0"))
	float SurfaceTriggerDistance = 8000.f;

	/** Длительность выхода (дуга головы над песком), с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Timing", meta = (ClampMin = "1"))
	float SurfaceDuration = 10.f;

	/** В Listening червь медленно смещается к источнику шума, см/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float ListenDriftSpeed = 500.f;

	/** Скорость «блуждания» в покое, см/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float DormantWanderSpeed = 250.f;

	/** Радиус блуждания вокруг точки покоя, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float DormantWanderRadius = 30000.f;

	/** Глубина головы в Listening, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float ListenDepth = 4500.f;

	/** Глубина головы в Approach (волна песка видна над ней), см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float ApproachDepth = 2400.f;

	/** Высота головы над песком в состоянии Ridden, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float RiddenHeadHeight = 1600.f;

	/** Максимальная вертикальная скорость головы вне скриптованного выхода, см/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "1"))
	float VerticalSpeed = 1200.f;

	/** Скорость поворота в Approach, град/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float ApproachTurnRate = 18.f;

	/** Скорость поворота в остальных состояниях (огромная инерция), град/с. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Motion", meta = (ClampMin = "0"))
	float CruiseTurnRate = 5.f;

	/** Амплитуда вертикальной волны тела, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0"))
	float UndulationAmplitude = 350.f;

	/** Длина вертикальной волны тела, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "100"))
	float UndulationWavelength = 9000.f;

	/** Частота волны тела, Гц. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "0"))
	float UndulationFrequency = 0.12f;

	/** Длина головы (вдоль оси), см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Body", meta = (ClampMin = "100"))
	float HeadLength = 3000.f;

	/** Дистанция, на которой угроза падает до минимума состояния, см. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Feedback", meta = (ClampMin = "100"))
	float ThreatMaxDistance = 60000.f;

	/** Скорость сглаживания угрозы (FInterpTo). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Feedback", meta = (ClampMin = "0"))
	float ThreatInterpSpeed = 1.5f;

	/** Частота «мозга» (сенсоры, автомат состояний), Гц. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Performance", meta = (ClampMin = "1", ClampMax = "60"))
	float SenseHz = 10.f;

	/** Частота обновления тела (тик актора), Гц. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Rakis|Worm|Performance", meta = (ClampMin = "5", ClampMax = "120"))
	float MovementHz = 30.f;
};
