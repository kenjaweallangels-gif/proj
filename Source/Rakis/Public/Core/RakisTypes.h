#pragma once

#include "CoreMinimal.h"
#include "RakisTypes.generated.h"

/**
 * Общие перечисления проекта Rakis. Файл — часть контракта (docs/06_demo_contract.md):
 * менять значения можно только через orchestrator.
 */

/** Поверхность под ногами. Совпадает с SurfaceType1..6 в Config/DefaultEngine.ini. */
UENUM(BlueprintType)
enum class ERakisSurface : uint8
{
	Unknown		UMETA(DisplayName = "Unknown"),
	Sand		UMETA(DisplayName = "Sand"),
	Rock		UMETA(DisplayName = "Rock"),
	SietchStone	UMETA(DisplayName = "Sietch Stone"),
	Cloth		UMETA(DisplayName = "Cloth"),
	Metal		UMETA(DisplayName = "Metal"),
	PackedSand	UMETA(DisplayName = "Packed (drum) Sand")
};

/** Зоны среза: A — пустыня, B — сиетч «Табр-ан-Нур». */
UENUM(BlueprintType)
enum class ERakisZone : uint8
{
	None		UMETA(DisplayName = "None"),
	A1_Ridge	UMETA(DisplayName = "A1 Ridge"),
	A2_Erg		UMETA(DisplayName = "A2 Open Erg"),
	A3_Approach	UMETA(DisplayName = "A3 Rocky Approach"),
	A4_Crevice	UMETA(DisplayName = "A4 Hidden Crevice"),
	A5_Trail	UMETA(DisplayName = "A5 Cliff Trail"),
	A6_Cleft	UMETA(DisplayName = "A6 Hidden Cleft"),
	B1_Airlock	UMETA(DisplayName = "B1 Airlock"),
	B2_Gallery	UMETA(DisplayName = "B2 Lower Gallery"),
	B3_Passages	UMETA(DisplayName = "B3 Passages"),
	B4_Cistern	UMETA(DisplayName = "B4 Cistern"),
	B5_Hall		UMETA(DisplayName = "B5 Religious Hall"),
	C1_Garden	UMETA(DisplayName = "C1 Sheltered Garden")
};

/** Состояния червя (GDD §5). */
UENUM(BlueprintType)
enum class ERakisWormState : uint8
{
	Dormant		UMETA(DisplayName = "Dormant"),
	Listening	UMETA(DisplayName = "Listening"),
	Approach	UMETA(DisplayName = "Approach"),
	Surface		UMETA(DisplayName = "Surface"),
	Ridden		UMETA(DisplayName = "Ridden"),
	Pass		UMETA(DisplayName = "Pass")
};

/** Состояние адаптивной музыки (docs/audio/soundmap.md). */
UENUM(BlueprintType)
enum class ERakisMusicState : uint8
{
	Silence		UMETA(DisplayName = "Silence"),
	DesertCalm	UMETA(DisplayName = "Desert Calm"),
	DesertDrone	UMETA(DisplayName = "Desert Drone"),
	WormThreat	UMETA(DisplayName = "Worm Threat"),
	WormReveal	UMETA(DisplayName = "Worm Reveal"),
	SietchLife	UMETA(DisplayName = "Sietch Life"),
	SietchNarrow UMETA(DisplayName = "Sietch Narrow"),
	HallChorale	UMETA(DisplayName = "Hall Chorale")
};

/** Язык субтитров/озвучки. */
UENUM(BlueprintType)
enum class ERakisLanguage : uint8
{
	RU,
	EN
};
