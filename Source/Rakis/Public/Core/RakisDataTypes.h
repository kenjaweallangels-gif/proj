#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "RakisDataTypes.generated.h"

/**
 * Строки DataTable. Имена полей = заголовки CSV в Content/Rakis/Data/*.csv
 * (первая колонка CSV — имя строки). Контракт: docs/06_demo_contract.md §4.
 */

/** Dialogue_S1.csv: DialogueID,Speaker,Line_RU,Line_EN,Condition,Emotion,VO_File,Duration,NextID */
USTRUCT(BlueprintType)
struct FRakisDialogueRow : public FTableRowBase
{
	GENERATED_BODY()

	/** Kair, Ilva, Rayn, Ossana, Rider1, Rider2, Guard, Harmat, Priestess, Crowd */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FName Speaker;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FString Line_RU;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FString Line_EN;
	/** Условие показа (пусто = всегда), напр. "WormState:Surface" или "Beat:B2_Enter". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FName Condition;
	/** Neutral, Calm, Tense, Afraid, Angry, Whisper, Reverent, Wry */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FName Emotion;
	/** Путь к SoundWave/MetaSound (/Game/Rakis/Audio/VO/...) или пусто. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FString VO_File;
	/** Длительность показа, сек. 0 = авто (по длине строки). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") float Duration = 0.f;
	/** Следующая реплика цепочки (пусто = конец). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Dialogue") FName NextID;
};

/** Barks.csv: BarkID,Archetype,Context,Line_RU,Line_EN,VO_File,Weight,Cooldown */
USTRUCT(BlueprintType)
struct FRakisBarkRow : public FTableRowBase
{
	GENERATED_BODY()

	/** Trader, Artisan, WaterCarrier, Child, Guard, Pilgrim, Elder, Weaver */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") FName Archetype;
	/** Idle, Stranger, Market, Water, Shiana, Kin, WormNear, Ritual, Offworld */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") FName Context;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") FString Line_RU;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") FString Line_EN;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") FString VO_File;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") float Weight = 1.f;
	/** Минимальная пауза перед повтором этой реплики, сек. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Barks") float Cooldown = 60.f;
};

/** CrowdArchetypes.csv: Archetype,DisplayName_RU,DisplayName_EN,BaseMesh,WalkSpeed,SmartObjectTags,ClothPalette,Accessories,SpawnWeight,AgeGroup */
USTRUCT(BlueprintType)
struct FRakisCrowdArchetypeRow : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FString DisplayName_RU;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FString DisplayName_EN;
	/** Путь к SkeletalMesh базы (MetaHuman/модульная) — может быть пустым на блокауте. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FString BaseMesh;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") float WalkSpeed = 120.f;
	/** Теги Smart Object через ';', напр. "Loom;Bench;Prayer". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FString SmartObjectTags;
	/** Палитра одежды: hex через ';', напр. "#6B4F36;#2C3E57;#B89A6A". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FString ClothPalette;
	/** Модули-аксессуары через ';' (имена из docs/art/characters/modular_clothing.md). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FString Accessories;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") float SpawnWeight = 1.f;
	/** Child, Adult, Elder */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Crowd") FName AgeGroup;
};

/** AudioEvents.csv: EventID,Trigger,Asset,Bus,Attenuation,Priority,Volume,Is2D */
USTRUCT(BlueprintType)
struct FRakisAudioEventRow : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") FName Trigger;
	/** /Game/Rakis/Audio/... (SoundBase/MetaSoundSource). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") FString Asset;
	/** Music, Ambience, SFX, VO, UI */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") FName Bus;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") FString Attenuation;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") int32 Priority = 0;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") float Volume = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Audio") bool Is2D = false;
};

/** WeatherPresets.csv — пресеты погоды/времени суток (см. docs/tech-art/lighting_weather.md). */
USTRUCT(BlueprintType)
struct FRakisWeatherPresetRow : public FTableRowBase
{
	GENERATED_BODY()

	/** Часы 0..24; задаёт высоту/азимут солнца. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float TimeOfDayHours = 9.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float SunIntensityLux = 110000.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") FLinearColor SunColor = FLinearColor(1.f, 0.93f, 0.82f);
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float SkyLightIntensity = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float FogDensity = 0.004f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float FogHeightFalloff = 0.08f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") FLinearColor FogInscatterColor = FLinearColor(0.78f, 0.62f, 0.45f);
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float VolumetricFogScattering = 0.6f;
	/** 0..1 — пыль в воздухе (Niagara, туман, MPC). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float DustDensity = 0.15f;
	/** м/с */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float WindSpeed = 6.f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float WindDirectionYaw = 60.f;
	/** 0..1 — стена бури на горизонте/вокруг игрока. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float StormIntensity = 0.f;
	/** 0..1 — сила марева. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float HeatHaze = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float ExposureBias = 1.25f;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Weather") float CloudCoverage = 0.1f;
};

/** StoryBeats.csv: BeatID,Order,Trigger,Action,Param,Delay — сценарий 01_scenario.md в данных. */
USTRUCT(BlueprintType)
struct FRakisStoryBeatRow : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Story") int32 Order = 0;
	/**
	 * Start | ZoneEnter:<ERakisZone без префикса, напр. A2_Erg> | Beat:<BeatID> (после завершения бита)
	 * | WormState:<ERakisWormState> | Interact:<ActorTag> | NoiseAbove:<0..1>
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Story") FName Trigger;
	/**
	 * PlayDialogue(Param=DialogueID) | PlayCinematic(Param=/Game/... LevelSequence) | SetWeather(Param=PresetID[,BlendSec])
	 * | SetMusic(Param=ERakisMusicState) | TitleCard(Param=RU|EN текст через '|') | ForceWorm(Param=ActorTag точки)
	 * | CrowdRitual | Hint(Param=RU|EN) | FadeOut(Param=сек) | EndDemo
	 * | Ellipsis(Param=<ТегЦели>[,<FadeSec>[,<AdvanceHours>]][,window=<сек>][,pull=<BeatID>@<сек>]...[|RU титр|EN титр]) —
	 *   склейка золотого пути: затемнение → перенос игрока и спутников к актору с тегом → +часы → титр поверх чёрного →
	 *   возврат; только если игрок на золотом пути (иначе отказ, Beat:<ID> не срабатывает). Консоль Rakis.Story.Ellipsis 0|1.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Story") FName Action;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Story") FString Param;
	/** Задержка после срабатывания триггера, сек. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Story") float Delay = 0.f;
};
