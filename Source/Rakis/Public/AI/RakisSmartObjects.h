#pragma once

#include "CoreMinimal.h"
#include "NativeGameplayTags.h"
#include "SmartObjectDefinition.h"
#include "RakisSmartObjects.generated.h"

/**
 * Smart Objects толпы сиетча (GDD §5 «NPC сиетча», docs/tech/crowd.md §2).
 *
 * Точки-маркеры уровня (TargetPoint с тегом Rakis.SmartObject.<Type>) при старте игры получают
 * USmartObjectComponent с USmartObjectDefinition своего типа:
 *  - ассет /Game/Rakis/AI/SmartObjects/SOD_<Type> (генерирует Tools/unreal_python/ai_smart_objects.py), если он есть
 *    и валиден (≥ 1 слот, activity-тег Rakis.SO.<Type>);
 *  - иначе — определение, собранное в рантайме (слоты по ёмкости типа, тег Rakis.SO.<Type>,
 *    поведение URakisSmartObjectBehaviorDefinition).
 * Регистрация и кэш — URakisCrowdSubsystem (RebuildSpotCache / EnsureSmartObject).
 */

/** Нативные gameplay-теги ИИ толпы (регистрируются при загрузке модуля, без DefaultGameplayTags.ini). */
namespace RakisAITags
{
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_Loom);
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_Stall);
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_WaterJar);
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_PrayerMat);
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_Bench);
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_Niche);
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(SO_StillsuitRepair);

	/** Событие StateTree: толпа идёт на ритуал (ARakisCitizen::BeginRitualFlow). */
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(Event_Ritual);
	/** Событие StateTree: игрок перегородил дорогу (ARakisCitizen, при обнаружении). */
	RAKIS_API UE_DECLARE_GAMEPLAY_TAG_EXTERN(Event_PlayerBlocking);

	/** Rakis.SO.<Type> по имени типа точки; невалидный тег, если тип неизвестен. */
	RAKIS_API FGameplayTag GetSpotTypeTag(FName SpotType);
}

/**
 * Поведение слота Smart Object для горожанина: длительность «работы» на точке и охота поговорить.
 * Используется в MarkSlotAsOccupied (класс поведения) — на каждом слоте должно быть одно такое поведение.
 */
UCLASS(EditInlineNew, BlueprintType, CollapseCategories, meta = (DisplayName = "Rakis Citizen Spot Behavior"))
class RAKIS_API URakisSmartObjectBehaviorDefinition : public USmartObjectBehaviorDefinition
{
	GENERATED_BODY()

public:
	/** Тип точки (Loom, Stall, ...) — для AnimBP (ARakisCitizen::CurrentSpotType) и звука SmartObject:<Type>. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis")
	FName SpotType;

	/** Сколько стоять на точке, сек. ≤ 0 — значения горожанина (SpotIdleMin/Max). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis")
	float UseDurationMin = -1.f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis")
	float UseDurationMax = -1.f;

	/** Множитель вероятности разговора на точке (Bench/Stall/WaterJar — болтают охотнее). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis", meta = (ClampMin = "0.0"))
	float TalkChanceScale = 1.f;
};

namespace RakisSmartObjects
{
	/** Ёмкость (число слотов) типа точки: Bench 3, Stall/WaterJar 2, прочие 1. */
	RAKIS_API int32 GetSpotCapacity(FName SpotType);

	/** Путь ассета-определения: /Game/Rakis/AI/SmartObjects/SOD_<Type>.SOD_<Type>. */
	RAKIS_API FSoftObjectPath GetDefinitionAssetPath(FName SpotType);

	/**
	 * Ассет SOD_<Type>, если он существует и пригоден (есть слоты и тег Rakis.SO.<Type>); иначе — определение,
	 * собранное в рантайме (Outer владеет им). nullptr — тип неизвестен.
	 */
	RAKIS_API USmartObjectDefinition* LoadOrBuildDefinition(UObject* Outer, FName SpotType, bool& bOutFromAsset);
}
