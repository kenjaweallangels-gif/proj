#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/RakisDataTypes.h"
#include "RakisWeatherSubsystem.generated.h"

class UDataTable;
class UMaterialParameterCollection;
class UMaterialInstanceDynamic;
class UDirectionalLightComponent;
class USkyLightComponent;
class USkyAtmosphereComponent;
class UExponentialHeightFogComponent;
class UVolumetricCloudComponent;
class UWindDirectionalSourceComponent;
class APostProcessVolume;
class ULevel;

/** Пресет погоды сменился (после запроса, в начале смешивания). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FRakisOnWeatherPresetChanged, FName, PresetId);

/**
 * Погода и время суток Ракиса (docs/06_demo_contract.md §1.2, §2.2 Weather/, §2.5 MPC).
 *
 * - Пресеты: DT_WeatherPresets (FRakisWeatherPresetRow) из URakisSettings; при отсутствии
 *   таблицы/строки — встроенные пресеты в коде (блокаут играется без данных).
 * - Плавное смешивание всех полей пресета (smoothstep), солнце — по астрономической формуле
 *   из TimeOfDayHours и широты (восход на востоке, полдень на юге).
 * - Управляет: солнцем (тег Rakis.Sun), SkyLight, Exponential Height Fog, Volumetric Cloud,
 *   Sky Atmosphere (рассеяние Ми от пыли), PostProcessVolume (тег Rakis.PP.Global),
 *   WindDirectionalSource и MPC_RakisWeather.
 * - WormThreat01 в MPC пишет червь — здесь не трогаем.
 * - TimeOfDayHours < 0 в пресете означает «сохранить текущее время суток».
 *
 * Консоль: Rakis.Weather <PresetId> [BlendSec], Rakis.TimeOfDay <Hours>.
 */
UCLASS(Config = Game)
class RAKIS_API URakisWeatherSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	/** Удобный доступ из любого объекта мира. Может вернуть nullptr (редакторный мир). */
	static URakisWeatherSubsystem* Get(const UObject* WorldContextObject);

	// USubsystem / UWorldSubsystem
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;

	// FTickableGameObject
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/** Запросить пресет погоды с плавным переходом. Повторный запрос текущего пресета игнорируется. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Weather")
	void RequestPreset(FName PresetId, float BlendSeconds = 8.f);

	/** Текущий (целевой) пресет. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	FName GetCurrentPreset() const { return TargetPresetId; }

	/** Скорость ветра с порывами, м/с. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	float GetWindSpeed() const { return GustedWindSpeed; }

	/** Направление потока ветра (куда дует), единичный вектор в XY. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	FVector GetWindDirection() const { return GustedWindDirection; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	float GetStormIntensity() const { return Current.StormIntensity; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	float GetDustDensity() const { return Current.DustDensity; }

	/** Время суток, часы 0..24. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	float GetTimeOfDay() const { return Current.TimeOfDayHours; }

	/** Мгновенно выставить время суток (сохраняется до следующего пресета с явным временем). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Weather")
	void SetTimeOfDay(float Hours);

	/** Единичный вектор НА солнце (мировые координаты). */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	FVector GetSunDirection() const { return SunDirection; }

	/** Высота солнца над горизонтом, градусы. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	float GetSunElevationDeg() const { return SunElevationDeg; }

	/** Интерьерность 0..1 (плавная) — пишется в MPC Interior01. Вызывает URakisZoneSubsystem. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Weather")
	void SetInterior(bool bInterior, float BlendSeconds = 2.f);

	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	float GetInterior01() const { return InteriorCurrent; }

	/** Текущие смешанные значения пресета. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Weather")
	FRakisWeatherPresetRow GetCurrentValues() const { return Current; }

	/** Найти пресет: сначала DataTable, затем встроенный. */
	bool FindPreset(FName PresetId, FRakisWeatherPresetRow& OutRow) const;

	/** Пересканировать сцену (свет, туман, облака, пост). Вызывается автоматически при подгрузке уровней. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Weather")
	void RefreshSceneActors();

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Weather")
	FRakisOnWeatherPresetChanged OnPresetChanged;

	// ---------- Тюнинг (значения по умолчанию; подсистему нельзя редактировать в деталях, переопределяются в DefaultGame.ini, секция [/Script/Rakis.RakisWeatherSubsystem]) ----------

	/** Широта Ракиса для траектории солнца, градусы (северное полушарие). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sun")
	float LatitudeDeg = 23.f;

	/** Склонение солнца (сезон), градусы. +12 ≈ начало лета: высокое полуденное солнце, восход чуть севернее востока. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sun")
	float SolarDeclinationDeg = 12.f;

	/** Yaw мирового «севера»: 0 => +X — север, +Y — восток (UE: yaw растёт от X к Y). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sun")
	float NorthYawDeg = 0.f;

	/** Скорость хода времени, игровых часов за реальную секунду (0 — время стоит, срез фиксирован). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sun")
	float TimeScaleHoursPerSecond = 0.f;

	/** Порывы: относительная амплитуда модуляции скорости ветра. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Wind")
	float GustAmplitude = 0.35f;

	/** Добавка к амплитуде порывов при StormIntensity = 1. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Wind")
	float StormGustBoost = 0.4f;

	/** Рыскание направления ветра в порывах, градусы. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Wind")
	float GustYawJitterDeg = 12.f;

	/** Множитель плотности тумана при StormIntensity = 1. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Fog")
	float StormFogBoost = 2.5f;

	/** Volumetric fog extinction = 1 + DustDensity * это. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Fog")
	float DustExtinctionScale = 4.f;

	/** Sky Atmosphere: множитель рассеяния Ми = база * (1 + DustDensity * это). */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sky")
	float DustMieScale = 3.f;

	/** Минимальный интервал между RecaptureSky (если real-time capture выключен), сек. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sky")
	float SkyRecaptureMinInterval = 2.f;

	/** Порог изменения высоты солнца для RecaptureSky, градусы. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sky")
	float SkyRecaptureSunDeltaDeg = 1.5f;

	/** Имя скалярного параметра покрытия в материале облаков. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather|Sky")
	FName CloudCoverageParam = TEXT("Coverage");

	/** Пресет при старте мира, если зона ещё ничего не запросила. */
	UPROPERTY(Config, EditDefaultsOnly, Category = "Rakis|Weather")
	FName InitialPreset = TEXT("Dawn_Ridge");

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

private:
	void LoadData();
	void BuildBuiltInPresets();
	void HandleLevelAddedToWorld(ULevel* InLevel, UWorld* InWorld);

	static FRakisWeatherPresetRow LerpPreset(const FRakisWeatherPresetRow& A, const FRakisWeatherPresetRow& B, float Alpha);

	void UpdateSun();
	void UpdateWind(float WorldTime);
	void ApplyToScene(float DeltaTime, bool bApplyStatic);
	void ApplyWindSources();
	void WriteMPC();

	void WriteScalar(FName Name, float Value);
	void WriteVector(FName Name, const FLinearColor& Value);
	bool MPCHasParam(FName Name, bool bVector);

	/** Строки DataTable. */
	UPROPERTY(Transient)
	TObjectPtr<UDataTable> PresetTable;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialParameterCollection> WeatherMPC;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialInstanceDynamic> CloudMID;

	TMap<FName, FRakisWeatherPresetRow> BuiltInPresets;

	FRakisWeatherPresetRow FromPreset;
	FRakisWeatherPresetRow ToPreset;
	FRakisWeatherPresetRow Current;
	FName TargetPresetId;
	float BlendDuration = 0.f;
	float BlendElapsed = 0.f;
	bool bBlending = false;
	bool bHasPreset = false;
	bool bSceneDirty = true;

	float InteriorCurrent = 0.f;
	float InteriorTarget = 0.f;
	float InteriorRate = 1.f;

	float GustedWindSpeed = 0.f;
	FVector GustedWindDirection = FVector::ForwardVector;
	FVector SunDirection = FVector::UpVector;
	float SunElevationDeg = 45.f;

	float LastRecaptureTime = -1000.f;
	float LastRecaptureElevation = -1000.f;
	float BaseMieScatteringScale = -1.f;

	TWeakObjectPtr<UDirectionalLightComponent> SunLight;
	TWeakObjectPtr<USkyLightComponent> SkyLight;
	TWeakObjectPtr<USkyAtmosphereComponent> SkyAtmosphere;
	TWeakObjectPtr<UExponentialHeightFogComponent> HeightFog;
	TWeakObjectPtr<UVolumetricCloudComponent> Clouds;
	TWeakObjectPtr<APostProcessVolume> GlobalPP;
	TArray<TWeakObjectPtr<UWindDirectionalSourceComponent>> WindSources;
	/** Niagara-компоненты акторов с тегом Rakis.FX.Wind (позёмка, вихри, стена бури). */
	TArray<TWeakObjectPtr<class UNiagaraComponent>> WindFX;

	TMap<FName, bool> MPCParamCache;
	bool bWarnedNoMPC = false;
	bool bWarnedNoTable = false;
	bool bWarnedNoSun = false;
	bool bWarnedNoPP = false;
	bool bWarnedSunStatic = false;
	TSet<FName> WarnedMissingPresets;

	FDelegateHandle LevelAddedHandle;
};
