#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "RakisSettings.generated.h"

class UDataTable;
class UMaterialParameterCollection;
class URakisWormTuning;
class URakisNoiseTuning;
class URakisHydrationTuning;

/**
 * Проектные настройки Rakis (Project Settings → Game → Rakis).
 * Значения по умолчанию лежат в Config/DefaultGame.ini, секция [/Script/Rakis.RakisSettings].
 * Любая система получает свои данные отсюда: URakisSettings::Get()->WormTuning.LoadSynchronous().
 */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Rakis"))
class RAKIS_API URakisSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	static const URakisSettings* Get() { return GetDefault<URakisSettings>(); }

	virtual FName GetCategoryName() const override { return TEXT("Game"); }

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Tuning") TSoftObjectPtr<URakisWormTuning> WormTuning;
	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Tuning") TSoftObjectPtr<URakisNoiseTuning> NoiseTuning;
	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Tuning") TSoftObjectPtr<URakisHydrationTuning> HydrationTuning;

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Data", meta = (RequiredAssetDataTags = "RowStructure=/Script/Rakis.RakisWeatherPresetRow"))
	TSoftObjectPtr<UDataTable> WeatherPresets;

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Data", meta = (RequiredAssetDataTags = "RowStructure=/Script/Rakis.RakisDialogueRow"))
	TSoftObjectPtr<UDataTable> DialogueTable;

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Data", meta = (RequiredAssetDataTags = "RowStructure=/Script/Rakis.RakisBarkRow"))
	TSoftObjectPtr<UDataTable> BarksTable;

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Data", meta = (RequiredAssetDataTags = "RowStructure=/Script/Rakis.RakisCrowdArchetypeRow"))
	TSoftObjectPtr<UDataTable> CrowdArchetypes;

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Data", meta = (RequiredAssetDataTags = "RowStructure=/Script/Rakis.RakisAudioEventRow"))
	TSoftObjectPtr<UDataTable> AudioEvents;

	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Data", meta = (RequiredAssetDataTags = "RowStructure=/Script/Rakis.RakisStoryBeatRow"))
	TSoftObjectPtr<UDataTable> StoryBeats;

	/** MPC_RakisWeather — параметры погоды для всех материалов (имена в docs/06_demo_contract.md §5). */
	UPROPERTY(Config, EditAnywhere, Category = "Rakis|Rendering") TSoftObjectPtr<UMaterialParameterCollection> WeatherMPC;
};
