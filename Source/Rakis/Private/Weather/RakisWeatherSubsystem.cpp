#include "Weather/RakisWeatherSubsystem.h"

#include "Rakis.h"
#include "Core/RakisSettings.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/WindDirectionalSourceComponent.h"
#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "Engine/Level.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialParameterCollection.h"
#include "NiagaraComponent.h"
#include "UObject/UnrealType.h"

namespace RakisWeatherPrivate
{
	static const FName TagSun(TEXT("Rakis.Sun"));
	static const FName TagSkyLight(TEXT("Rakis.SkyLight"));
	static const FName TagGlobalPP(TEXT("Rakis.PP.Global"));

	// Имена параметров MPC_RakisWeather (контракт §2.5).
	static const FName P_WindSpeed(TEXT("WindSpeed"));
	static const FName P_StormIntensity(TEXT("StormIntensity"));
	static const FName P_DustDensity(TEXT("DustDensity"));
	static const FName P_HeatHaze(TEXT("HeatHaze"));
	static const FName P_TimeOfDay01(TEXT("TimeOfDay01"));
	static const FName P_Interior01(TEXT("Interior01"));
	static const FName P_WindDirection(TEXT("WindDirection"));
	static const FName P_SunDirection(TEXT("SunDirection"));
	static const FName P_SandTint(TEXT("SandTint"));
	static const FName P_PlayerPosition(TEXT("PlayerPosition"));

	static const TCHAR* FallbackMPCPath = TEXT("/Game/Rakis/Materials/Functions/MPC_RakisWeather.MPC_RakisWeather");

	/** Чтение float-свойства по имени через рефлексию (устойчиво к смене доступа в заголовках движка). */
	static float ReadFloatProperty(const UObject* Object, FName PropertyName, float Default)
	{
		if (!Object)
		{
			return Default;
		}
		if (const FFloatProperty* Prop = FindFProperty<FFloatProperty>(Object->GetClass(), PropertyName))
		{
			return Prop->GetPropertyValue_InContainer(Object);
		}
		return Default;
	}

	/** Чтение bool-свойства (в т.ч. битового поля) по имени через рефлексию. */
	static bool ReadBoolProperty(const UObject* Object, FName PropertyName, bool Default)
	{
		if (!Object)
		{
			return Default;
		}
		if (const FBoolProperty* Prop = FindFProperty<FBoolProperty>(Object->GetClass(), PropertyName))
		{
			return Prop->GetPropertyValue_InContainer(Object);
		}
		return Default;
	}

	/** Материал облаков через рефлексию (свойство UVolumetricCloudComponent::Material). */
	static UMaterialInterface* GetCloudMaterial(const UVolumetricCloudComponent* Cloud)
	{
		if (!Cloud)
		{
			return nullptr;
		}
		if (const FObjectPropertyBase* Prop = FindFProperty<FObjectPropertyBase>(Cloud->GetClass(), TEXT("Material")))
		{
			return Cast<UMaterialInterface>(Prop->GetObjectPropertyValue_InContainer(Cloud));
		}
		return nullptr;
	}

	static float WrapHours(float H)
	{
		H = FMath::Fmod(H, 24.f);
		return H < 0.f ? H + 24.f : H;
	}

	static FRakisWeatherPresetRow MakePreset(float Hours, float Lux, const FLinearColor& SunColor, float Sky,
		float FogDensity, float FogFalloff, const FLinearColor& Inscatter, float VolScatter, float Dust,
		float Wind, float WindYaw, float Storm, float Haze, float Exposure, float Clouds)
	{
		FRakisWeatherPresetRow R;
		R.TimeOfDayHours = Hours;
		R.SunIntensityLux = Lux;
		R.SunColor = SunColor;
		R.SkyLightIntensity = Sky;
		R.FogDensity = FogDensity;
		R.FogHeightFalloff = FogFalloff;
		R.FogInscatterColor = Inscatter;
		R.VolumetricFogScattering = VolScatter;
		R.DustDensity = Dust;
		R.WindSpeed = Wind;
		R.WindDirectionYaw = WindYaw;
		R.StormIntensity = Storm;
		R.HeatHaze = Haze;
		R.ExposureBias = Exposure;
		R.CloudCoverage = Clouds;
		return R;
	}
}

// ---------------------------------------------------------------------------------------------
// Консольные команды
// ---------------------------------------------------------------------------------------------

static void RakisWeatherCommand(const TArray<FString>& Args, UWorld* World)
{
	URakisWeatherSubsystem* Weather = World ? World->GetSubsystem<URakisWeatherSubsystem>() : nullptr;
	if (!Weather)
	{
		UE_LOG(LogRakis, Warning, TEXT("Rakis.Weather: подсистема погоды недоступна в этом мире."));
		return;
	}
	if (Args.Num() < 1)
	{
		UE_LOG(LogRakis, Display, TEXT("Rakis.Weather <PresetId> [BlendSec]. Текущий: %s"), *Weather->GetCurrentPreset().ToString());
		return;
	}
	const float Blend = Args.Num() >= 2 ? FCString::Atof(*Args[1]) : 8.f;
	Weather->RequestPreset(FName(*Args[0]), Blend);
}

static void RakisTimeOfDayCommand(const TArray<FString>& Args, UWorld* World)
{
	URakisWeatherSubsystem* Weather = World ? World->GetSubsystem<URakisWeatherSubsystem>() : nullptr;
	if (!Weather)
	{
		UE_LOG(LogRakis, Warning, TEXT("Rakis.TimeOfDay: подсистема погоды недоступна в этом мире."));
		return;
	}
	if (Args.Num() < 1)
	{
		UE_LOG(LogRakis, Display, TEXT("Rakis.TimeOfDay <Hours 0..24>. Сейчас: %.2f"), Weather->GetTimeOfDay());
		return;
	}
	Weather->SetTimeOfDay(FCString::Atof(*Args[0]));
}

static FAutoConsoleCommandWithWorldAndArgs GRakisWeatherCmd(
	TEXT("Rakis.Weather"),
	TEXT("Rakis.Weather <PresetId> [BlendSec] — сменить пресет погоды (Dawn_Ridge, Morning_Erg, Worm_Tension, Worm_Reveal, Noon_Approach, Storm_Horizon, Crevice_Shade, Sietch_Interior, Hall_Ritual)."),
	FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&RakisWeatherCommand));

static FAutoConsoleCommandWithWorldAndArgs GRakisTimeOfDayCmd(
	TEXT("Rakis.TimeOfDay"),
	TEXT("Rakis.TimeOfDay <Hours> — выставить время суток (0..24)."),
	FConsoleCommandWithWorldAndArgsDelegate::CreateStatic(&RakisTimeOfDayCommand));

// ---------------------------------------------------------------------------------------------

URakisWeatherSubsystem* URakisWeatherSubsystem::Get(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World ? World->GetSubsystem<URakisWeatherSubsystem>() : nullptr;
}

bool URakisWeatherSubsystem::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

void URakisWeatherSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	BuildBuiltInPresets();
	LevelAddedHandle = FWorldDelegates::LevelAddedToWorld.AddUObject(this, &URakisWeatherSubsystem::HandleLevelAddedToWorld);
}

void URakisWeatherSubsystem::Deinitialize()
{
	FWorldDelegates::LevelAddedToWorld.Remove(LevelAddedHandle);
	LevelAddedHandle.Reset();
	CloudMID = nullptr;
	PresetTable = nullptr;
	WeatherMPC = nullptr;

	Super::Deinitialize();
}

TStatId URakisWeatherSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(URakisWeatherSubsystem, STATGROUP_Tickables);
}

void URakisWeatherSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);

	LoadData();
	RefreshSceneActors();

	// Стартовое состояние — без смешивания, чтобы первый кадр был уже «правильным».
	if (!bHasPreset)
	{
		FRakisWeatherPresetRow Initial;
		if (FindPreset(InitialPreset, Initial))
		{
			Current = Initial;
			FromPreset = Initial;
			ToPreset = Initial;
			TargetPresetId = InitialPreset;
			bHasPreset = true;
		}
	}
	if (Current.TimeOfDayHours < 0.f)
	{
		Current.TimeOfDayHours = 9.f;
	}
}

void URakisWeatherSubsystem::HandleLevelAddedToWorld(ULevel* InLevel, UWorld* InWorld)
{
	if (InWorld == GetWorld())
	{
		RefreshSceneActors();
	}
}

void URakisWeatherSubsystem::LoadData()
{
	const URakisSettings* Settings = URakisSettings::Get();

	if (!PresetTable && Settings && !Settings->WeatherPresets.IsNull())
	{
		PresetTable = Settings->WeatherPresets.LoadSynchronous();
	}
	if (PresetTable && PresetTable->GetRowStruct() != FRakisWeatherPresetRow::StaticStruct())
	{
		UE_LOG(LogRakis, Warning, TEXT("Weather: %s имеет неверную структуру строк — используются встроенные пресеты."), *PresetTable->GetName());
		PresetTable = nullptr;
	}
	if (!PresetTable && !bWarnedNoTable)
	{
		bWarnedNoTable = true;
		UE_LOG(LogRakis, Warning, TEXT("Weather: DT_WeatherPresets не найден — используются встроенные пресеты."));
	}

	if (!WeatherMPC)
	{
		if (Settings && !Settings->WeatherMPC.IsNull())
		{
			WeatherMPC = Settings->WeatherMPC.LoadSynchronous();
		}
		if (!WeatherMPC)
		{
			WeatherMPC = LoadObject<UMaterialParameterCollection>(nullptr, RakisWeatherPrivate::FallbackMPCPath, nullptr, LOAD_NoWarning | LOAD_Quiet);
		}
		if (!WeatherMPC && !bWarnedNoMPC)
		{
			bWarnedNoMPC = true;
			UE_LOG(LogRakis, Warning, TEXT("Weather: MPC_RakisWeather не найден — параметры материалов не обновляются."));
		}
	}
}

void URakisWeatherSubsystem::BuildBuiltInPresets()
{
	using RakisWeatherPrivate::MakePreset;
	BuiltInPresets.Reset();

	// Значения — физические (люксы), ориентир docs/06 §1.2 и docs/04 «Освещение и пост».
	// TimeOfDayHours < 0 — сохранить текущее время суток.
	// WindDirectionYaw — куда дует поток (буря на юго-западе => поток на северо-восток, ~45–60°).

	//                                         Hours  Lux       SunColor                                Sky   FogDen  Falloff Inscatter                              VolSc Dust  Wind  Yaw   Storm Haze  Exp   Cloud
	BuiltInPresets.Add(TEXT("Dawn_Ridge"),      MakePreset(6.67f, 16000.f,  FLinearColor(1.00f, 0.60f, 0.38f), 0.85f, 0.012f, 0.14f, FLinearColor(0.86f, 0.60f, 0.50f), 0.70f, 0.12f, 3.f,  60.f, 0.f,  0.05f, 0.75f, 0.15f));
	BuiltInPresets.Add(TEXT("Morning_Erg"),     MakePreset(8.5f,  75000.f,  FLinearColor(1.00f, 0.88f, 0.74f), 1.00f, 0.006f, 0.10f, FLinearColor(0.82f, 0.68f, 0.52f), 0.60f, 0.18f, 6.f,  60.f, 0.f,  0.60f, 1.25f, 0.08f));
	BuiltInPresets.Add(TEXT("Worm_Tension"),    MakePreset(-1.f,  68000.f,  FLinearColor(1.00f, 0.84f, 0.68f), 0.90f, 0.009f, 0.14f, FLinearColor(0.78f, 0.63f, 0.47f), 0.70f, 0.32f, 1.5f, 60.f, 0.f,  0.45f, 1.00f, 0.08f));
	BuiltInPresets.Add(TEXT("Worm_Reveal"),     MakePreset(-1.f,  30000.f,  FLinearColor(1.00f, 0.78f, 0.58f), 0.70f, 0.030f, 0.05f, FLinearColor(0.72f, 0.56f, 0.40f), 0.80f, 0.85f, 4.f,  60.f, 0.15f, 0.20f, 1.00f, 0.10f));
	BuiltInPresets.Add(TEXT("Noon_Approach"),   MakePreset(11.5f, 110000.f, FLinearColor(1.00f, 0.95f, 0.88f), 1.10f, 0.004f, 0.08f, FLinearColor(0.85f, 0.72f, 0.56f), 0.55f, 0.15f, 7.f,  60.f, 0.f,  1.00f, 1.50f, 0.05f));
	BuiltInPresets.Add(TEXT("Storm_Horizon"),   MakePreset(12.0f, 95000.f,  FLinearColor(1.00f, 0.86f, 0.66f), 1.00f, 0.009f, 0.06f, FLinearColor(0.86f, 0.66f, 0.40f), 0.65f, 0.45f, 14.f, 45.f, 0.60f, 0.60f, 1.25f, 0.25f));
	BuiltInPresets.Add(TEXT("Crevice_Shade"),   MakePreset(-1.f,  90000.f,  FLinearColor(1.00f, 0.90f, 0.78f), 0.60f, 0.006f, 0.20f, FLinearColor(0.80f, 0.60f, 0.42f), 0.60f, 0.10f, 3.f,  60.f, 0.f,  0.15f, 1.00f, 0.15f));
	BuiltInPresets.Add(TEXT("Sietch_Interior"), MakePreset(18.3f, 1500.f,   FLinearColor(1.00f, 0.55f, 0.32f), 0.15f, 0.020f, 0.02f, FLinearColor(0.60f, 0.42f, 0.28f), 0.75f, 0.08f, 0.3f, 60.f, 0.f,  0.00f, 0.50f, 0.10f));
	// Луч в зале — солнце должно стоять достаточно высоко (≈46° в 15:00), иначе в шахту не попадёт.
	BuiltInPresets.Add(TEXT("Hall_Ritual"),     MakePreset(15.0f, 60000.f,  FLinearColor(1.00f, 0.78f, 0.55f), 0.20f, 0.025f, 0.02f, FLinearColor(0.62f, 0.45f, 0.30f), 0.85f, 0.25f, 0.2f, 60.f, 0.f,  0.00f, 0.50f, 0.05f));
}

bool URakisWeatherSubsystem::FindPreset(FName PresetId, FRakisWeatherPresetRow& OutRow) const
{
	if (PresetId.IsNone())
	{
		return false;
	}
	if (PresetTable)
	{
		if (const FRakisWeatherPresetRow* Row = PresetTable->FindRow<FRakisWeatherPresetRow>(PresetId, TEXT("RakisWeather"), false))
		{
			OutRow = *Row;
			return true;
		}
	}
	if (const FRakisWeatherPresetRow* BuiltIn = BuiltInPresets.Find(PresetId))
	{
		OutRow = *BuiltIn;
		return true;
	}
	return false;
}

void URakisWeatherSubsystem::RequestPreset(FName PresetId, float BlendSeconds)
{
	if (PresetId.IsNone())
	{
		return;
	}
	if (bHasPreset && PresetId == TargetPresetId)
	{
		return;
	}

	LoadData();

	FRakisWeatherPresetRow Target;
	if (!FindPreset(PresetId, Target))
	{
		if (!WarnedMissingPresets.Contains(PresetId))
		{
			WarnedMissingPresets.Add(PresetId);
			UE_LOG(LogRakis, Warning, TEXT("Weather: пресет '%s' не найден ни в DT_WeatherPresets, ни среди встроенных."), *PresetId.ToString());
		}
		return;
	}

	// «Сохранить время суток».
	if (Target.TimeOfDayHours < 0.f)
	{
		Target.TimeOfDayHours = Current.TimeOfDayHours >= 0.f ? Current.TimeOfDayHours : 9.f;
	}

	FromPreset = Current;
	ToPreset = Target;
	TargetPresetId = PresetId;
	BlendDuration = FMath::Max(0.f, BlendSeconds);
	BlendElapsed = 0.f;
	bBlending = BlendDuration > KINDA_SMALL_NUMBER && bHasPreset;
	if (!bBlending)
	{
		Current = Target;
	}
	bHasPreset = true;
	bSceneDirty = true;

	UE_LOG(LogRakis, Log, TEXT("Weather: -> %s за %.1f с"), *PresetId.ToString(), BlendDuration);
	OnPresetChanged.Broadcast(PresetId);
}

void URakisWeatherSubsystem::SetTimeOfDay(float Hours)
{
	const float H = RakisWeatherPrivate::WrapHours(Hours);
	Current.TimeOfDayHours = H;
	FromPreset.TimeOfDayHours = H;
	ToPreset.TimeOfDayHours = H;
	// Сразу пересчитать солнце (и разрешить рекапчур неба).
	LastRecaptureTime = -1000.f;
	bSceneDirty = true;
	UpdateSun();
}

void URakisWeatherSubsystem::SetInterior(bool bInterior, float BlendSeconds)
{
	InteriorTarget = bInterior ? 1.f : 0.f;
	InteriorRate = BlendSeconds > KINDA_SMALL_NUMBER ? 1.f / BlendSeconds : 1000.f;
}

FRakisWeatherPresetRow URakisWeatherSubsystem::LerpPreset(const FRakisWeatherPresetRow& A, const FRakisWeatherPresetRow& B, float Alpha)
{
	FRakisWeatherPresetRow R = B;

	// Время суток — по кратчайшей дуге через полночь.
	float DeltaH = B.TimeOfDayHours - A.TimeOfDayHours;
	if (DeltaH > 12.f) { DeltaH -= 24.f; }
	if (DeltaH < -12.f) { DeltaH += 24.f; }
	R.TimeOfDayHours = RakisWeatherPrivate::WrapHours(A.TimeOfDayHours + DeltaH * Alpha);

	// Свет удобнее смешивать в логарифме (люксы различаются на порядки).
	const float LogA = FMath::Loge(FMath::Max(A.SunIntensityLux, 1.f));
	const float LogB = FMath::Loge(FMath::Max(B.SunIntensityLux, 1.f));
	R.SunIntensityLux = FMath::Exp(FMath::Lerp(LogA, LogB, Alpha));

	R.SunColor = FLinearColor::LerpUsingHSV(A.SunColor, B.SunColor, Alpha);
	R.SkyLightIntensity = FMath::Lerp(A.SkyLightIntensity, B.SkyLightIntensity, Alpha);
	R.FogDensity = FMath::Lerp(A.FogDensity, B.FogDensity, Alpha);
	R.FogHeightFalloff = FMath::Lerp(A.FogHeightFalloff, B.FogHeightFalloff, Alpha);
	R.FogInscatterColor = FMath::Lerp(A.FogInscatterColor, B.FogInscatterColor, Alpha);
	R.VolumetricFogScattering = FMath::Lerp(A.VolumetricFogScattering, B.VolumetricFogScattering, Alpha);
	R.DustDensity = FMath::Lerp(A.DustDensity, B.DustDensity, Alpha);
	R.WindSpeed = FMath::Lerp(A.WindSpeed, B.WindSpeed, Alpha);
	R.WindDirectionYaw = A.WindDirectionYaw + FMath::FindDeltaAngleDegrees(A.WindDirectionYaw, B.WindDirectionYaw) * Alpha;
	R.StormIntensity = FMath::Lerp(A.StormIntensity, B.StormIntensity, Alpha);
	R.HeatHaze = FMath::Lerp(A.HeatHaze, B.HeatHaze, Alpha);
	R.ExposureBias = FMath::Lerp(A.ExposureBias, B.ExposureBias, Alpha);
	R.CloudCoverage = FMath::Lerp(A.CloudCoverage, B.CloudCoverage, Alpha);
	return R;
}

void URakisWeatherSubsystem::RefreshSceneActors()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	UDirectionalLightComponent* FirstSun = nullptr;
	UDirectionalLightComponent* TaggedSun = nullptr;
	USkyLightComponent* FirstSky = nullptr;
	USkyLightComponent* TaggedSky = nullptr;
	WindSources.Reset();
	WindFX.Reset();

	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* Actor = *It;
		if (!IsValid(Actor))
		{
			continue;
		}

		// Расставленные fx_niagara.py эффекты, читающие ветер через User-параметры.
		if (Actor->ActorHasTag(TEXT("Rakis.FX.Wind")))
		{
			TArray<UNiagaraComponent*> NiagaraComps;
			Actor->GetComponents(NiagaraComps);
			for (UNiagaraComponent* NC : NiagaraComps)
			{
				WindFX.Add(NC);
			}
		}

		if (UDirectionalLightComponent* Dir = Actor->FindComponentByClass<UDirectionalLightComponent>())
		{
			if (Actor->ActorHasTag(RakisWeatherPrivate::TagSun) && !TaggedSun) { TaggedSun = Dir; }
			if (!FirstSun) { FirstSun = Dir; }
		}
		if (USkyLightComponent* Sky = Actor->FindComponentByClass<USkyLightComponent>())
		{
			if (Actor->ActorHasTag(RakisWeatherPrivate::TagSkyLight) && !TaggedSky) { TaggedSky = Sky; }
			if (!FirstSky) { FirstSky = Sky; }
		}
		if (!HeightFog.IsValid())
		{
			HeightFog = Actor->FindComponentByClass<UExponentialHeightFogComponent>();
		}
		if (!Clouds.IsValid())
		{
			Clouds = Actor->FindComponentByClass<UVolumetricCloudComponent>();
		}
		if (!SkyAtmosphere.IsValid())
		{
			if (USkyAtmosphereComponent* Atmo = Actor->FindComponentByClass<USkyAtmosphereComponent>())
			{
				SkyAtmosphere = Atmo;
				BaseMieScatteringScale = RakisWeatherPrivate::ReadFloatProperty(Atmo, TEXT("MieScatteringScale"), 0.003996f);
			}
		}
		if (APostProcessVolume* PP = Cast<APostProcessVolume>(Actor))
		{
			if (PP->ActorHasTag(RakisWeatherPrivate::TagGlobalPP))
			{
				GlobalPP = PP;
			}
		}
		if (UWindDirectionalSourceComponent* Wind = Actor->FindComponentByClass<UWindDirectionalSourceComponent>())
		{
			WindSources.Add(Wind);
		}
	}

	// Предпочитаем тегированные; иначе — первые найденные (контракт §2.2 Hydration/Weather).
	if (!SunLight.IsValid() || (TaggedSun && SunLight.Get() != TaggedSun))
	{
		SunLight = TaggedSun ? TaggedSun : FirstSun;
	}
	if (!SkyLight.IsValid() || (TaggedSky && SkyLight.Get() != TaggedSky))
	{
		SkyLight = TaggedSky ? TaggedSky : FirstSky;
	}

	if (!SunLight.IsValid() && !bWarnedNoSun)
	{
		bWarnedNoSun = true;
		UE_LOG(LogRakis, Warning, TEXT("Weather: DirectionalLight (тег Rakis.Sun) не найден — солнце не управляется."));
	}
	if (!GlobalPP.IsValid() && !bWarnedNoPP)
	{
		bWarnedNoPP = true;
		UE_LOG(LogRakis, Warning, TEXT("Weather: PostProcessVolume с тегом Rakis.PP.Global не найден — экспозиция не управляется."));
	}

	bSceneDirty = true;

	// Динамический инстанс материала облаков — один раз.
	if (UVolumetricCloudComponent* Cloud = Clouds.Get())
	{
		UMaterialInterface* CloudMat = RakisWeatherPrivate::GetCloudMaterial(Cloud);
		if (CloudMat && CloudMat != CloudMID)
		{
			if (UMaterialInstanceDynamic* AsMID = Cast<UMaterialInstanceDynamic>(CloudMat))
			{
				CloudMID = AsMID;
			}
			else
			{
				CloudMID = UMaterialInstanceDynamic::Create(CloudMat, Cloud);
				if (CloudMID)
				{
					Cloud->SetMaterial(CloudMID);
				}
			}
		}
	}
}

void URakisWeatherSubsystem::Tick(float DeltaTime)
{
	UWorld* World = GetWorld();
	if (!World || !World->HasBegunPlay())
	{
		return;
	}

	// Смешивание пресетов.
	if (bBlending)
	{
		BlendElapsed += DeltaTime;
		const float Alpha = FMath::Clamp(BlendElapsed / FMath::Max(BlendDuration, KINDA_SMALL_NUMBER), 0.f, 1.f);
		Current = LerpPreset(FromPreset, ToPreset, FMath::SmoothStep(0.f, 1.f, Alpha));
		if (Alpha >= 1.f)
		{
			Current = ToPreset;
			bBlending = false;
			bSceneDirty = true; // применить финальные значения
		}
	}

	// Ход времени (по умолчанию выключен).
	if (TimeScaleHoursPerSecond != 0.f)
	{
		const float Advance = TimeScaleHoursPerSecond * DeltaTime;
		Current.TimeOfDayHours = RakisWeatherPrivate::WrapHours(Current.TimeOfDayHours + Advance);
		FromPreset.TimeOfDayHours = RakisWeatherPrivate::WrapHours(FromPreset.TimeOfDayHours + Advance);
		ToPreset.TimeOfDayHours = RakisWeatherPrivate::WrapHours(ToPreset.TimeOfDayHours + Advance);
	}

	InteriorCurrent = FMath::FInterpConstantTo(InteriorCurrent, InteriorTarget, DeltaTime, InteriorRate);

	UpdateSun();
	UpdateWind(World->GetTimeSeconds());
	// Свет/туман/пост трогаем только при изменениях (каждый сеттер пересоздаёт render state).
	const bool bApplyStatic = bSceneDirty || bBlending || TimeScaleHoursPerSecond != 0.f;
	ApplyToScene(DeltaTime, bApplyStatic);
	bSceneDirty = false;
	WriteMPC();
}

void URakisWeatherSubsystem::UpdateSun()
{
	// Астрономическая высота/азимут: H — часовой угол, φ — широта, δ — склонение.
	const float Lat = FMath::DegreesToRadians(LatitudeDeg);
	const float Dec = FMath::DegreesToRadians(SolarDeclinationDeg);
	const float HourAngle = FMath::DegreesToRadians(15.f * (Current.TimeOfDayHours - 12.f));

	const float SinEl = FMath::Sin(Lat) * FMath::Sin(Dec) + FMath::Cos(Lat) * FMath::Cos(Dec) * FMath::Cos(HourAngle);
	const float Elevation = FMath::Asin(FMath::Clamp(SinEl, -1.f, 1.f));
	// Азимут от севера по часовой (к востоку): утро => восток (90°), полдень => юг (180°).
	const float Azimuth = FMath::Atan2(FMath::Sin(HourAngle), FMath::Cos(HourAngle) * FMath::Sin(Lat) - FMath::Tan(Dec) * FMath::Cos(Lat)) + PI;

	SunElevationDeg = FMath::RadiansToDegrees(Elevation);
	const float SunYawDeg = FMath::RadiansToDegrees(Azimuth) + NorthYawDeg;

	// Вектор НА солнце; свет светит в противоположную сторону.
	const FRotator ToSunRot(SunElevationDeg, SunYawDeg, 0.f);
	SunDirection = ToSunRot.Vector();
}

void URakisWeatherSubsystem::UpdateWind(float WorldTime)
{
	// Слоистый шум: медленная «волна» + средние порывы + мелкая дрожь, сумма ≈ [-1..1].
	const float N =
		0.55f * FMath::PerlinNoise1D(WorldTime * 0.11f) +
		0.30f * FMath::PerlinNoise1D(WorldTime * 0.37f + 17.3f) +
		0.15f * FMath::PerlinNoise1D(WorldTime * 1.30f + 41.7f);

	const float Amp = GustAmplitude + StormGustBoost * Current.StormIntensity;
	GustedWindSpeed = FMath::Max(0.f, Current.WindSpeed * (1.f + Amp * N));

	const float YawJitter = GustYawJitterDeg * FMath::PerlinNoise1D(WorldTime * 0.07f + 5.1f);
	GustedWindDirection = FRotator(0.f, Current.WindDirectionYaw + NorthYawDeg + YawJitter, 0.f).Vector();
}

void URakisWeatherSubsystem::ApplyToScene(float DeltaTime, bool bApplyStatic)
{
	UWorld* World = GetWorld();
	const float Now = World ? World->GetTimeSeconds() : 0.f;

	// --- Ветер для травы/ткани/SpeedTree (каждый кадр — порывы) ---
	ApplyWindSources();

	if (!bApplyStatic)
	{
		return;
	}

	// --- Солнце ---
	if (UDirectionalLightComponent* Sun = SunLight.Get())
	{
		if (Sun->Mobility != EComponentMobility::Movable && !bWarnedSunStatic)
		{
			bWarnedSunStatic = true;
			UE_LOG(LogRakis, Warning, TEXT("Weather: солнце '%s' не Movable — поворот/яркость могут не применяться."), *GetNameSafe(Sun->GetOwner()));
		}
		// Плавное «закатывание» за горизонт.
		const float HorizonFade = FMath::SmoothStep(-1.5f, 3.f, SunElevationDeg);
		Sun->SetWorldRotation((-SunDirection).Rotation());
		Sun->SetIntensity(Current.SunIntensityLux * HorizonFade);
		Sun->SetLightColor(Current.SunColor, /*bSRGB*/ false);
	}

	// --- SkyLight: интенсивность; рекапчур — только если real-time capture выключен, с троттлингом ---
	if (USkyLightComponent* Sky = SkyLight.Get())
	{
		Sky->SetIntensity(Current.SkyLightIntensity);
		if (!RakisWeatherPrivate::ReadBoolProperty(Sky, TEXT("bRealTimeCapture"), false))
		{
			const bool bSunMoved = FMath::Abs(SunElevationDeg - LastRecaptureElevation) > SkyRecaptureSunDeltaDeg;
			if ((bSunMoved || bBlending) && Now - LastRecaptureTime > SkyRecaptureMinInterval)
			{
				Sky->RecaptureSky();
				LastRecaptureTime = Now;
				LastRecaptureElevation = SunElevationDeg;
			}
		}
	}

	// --- Туман ---
	if (UExponentialHeightFogComponent* Fog = HeightFog.Get())
	{
		const float StormMul = 1.f + StormFogBoost * Current.StormIntensity;
		Fog->SetFogDensity(Current.FogDensity * StormMul);
		Fog->SetFogHeightFalloff(Current.FogHeightFalloff);
		Fog->SetFogInscatteringColor(Current.FogInscatterColor);
		Fog->SetVolumetricFogScatteringDistribution(FMath::Clamp(Current.VolumetricFogScattering, -0.9f, 0.9f));
		Fog->SetVolumetricFogExtinctionScale(1.f + Current.DustDensity * DustExtinctionScale);
	}

	// --- Атмосфера: пыль поднимает рассеяние Ми (белёсое, «выбеленное» небо) ---
	if (USkyAtmosphereComponent* Atmo = SkyAtmosphere.Get())
	{
		if (BaseMieScatteringScale > 0.f)
		{
			Atmo->SetMieScatteringScale(BaseMieScatteringScale * (1.f + Current.DustDensity * DustMieScale));
		}
	}

	// --- Облака ---
	if (CloudMID)
	{
		CloudMID->SetScalarParameterValue(CloudCoverageParam, Current.CloudCoverage);
	}

	// --- Пост: экспозиция (марево — через MPC HeatHaze, его читает M_PP_HeatHaze) ---
	if (APostProcessVolume* PP = GlobalPP.Get())
	{
		PP->Settings.bOverride_AutoExposureBias = true;
		PP->Settings.AutoExposureBias = Current.ExposureBias;
	}
}

void URakisWeatherSubsystem::ApplyWindSources()
{
	const FRotator WindRot = GustedWindDirection.Rotation();
	for (const TWeakObjectPtr<UWindDirectionalSourceComponent>& WeakWind : WindSources)
	{
		if (UWindDirectionalSourceComponent* Wind = WeakWind.Get())
		{
			Wind->SetWorldRotation(WindRot);
			// Нормируем: 10 м/с ≈ сила 1.
			Wind->SetStrength(GustedWindSpeed / 10.f);
			Wind->SetSpeed(0.1f + GustedWindSpeed / 20.f);
			Wind->SetMinimumGustAmount(0.1f + 0.3f * Current.StormIntensity);
			Wind->SetMaximumGustAmount(0.3f + 0.6f * Current.StormIntensity);
		}
	}

	// Niagara: User.WindDirection / User.WindSpeed / User.Intensity (контракт §2.5).
	for (const TWeakObjectPtr<UNiagaraComponent>& WeakFX : WindFX)
	{
		if (UNiagaraComponent* NC = WeakFX.Get())
		{
			NC->SetVariableVec3(TEXT("User.WindDirection"), GustedWindDirection);
			NC->SetVariableFloat(TEXT("User.WindSpeed"), GustedWindSpeed);
			NC->SetVariableFloat(TEXT("User.Intensity"), FMath::Max(Current.DustDensity, Current.StormIntensity));
		}
	}
}

bool URakisWeatherSubsystem::MPCHasParam(FName Name, bool bVector)
{
	if (!WeatherMPC)
	{
		return false;
	}
	if (const bool* Cached = MPCParamCache.Find(Name))
	{
		return *Cached;
	}
	const bool bExists = bVector
		? WeatherMPC->GetVectorParameterByName(Name) != nullptr
		: WeatherMPC->GetScalarParameterByName(Name) != nullptr;
	MPCParamCache.Add(Name, bExists);
	if (!bExists)
	{
		UE_LOG(LogRakis, Warning, TEXT("Weather: в %s нет %s-параметра '%s'."), *WeatherMPC->GetName(), bVector ? TEXT("vector") : TEXT("scalar"), *Name.ToString());
	}
	return bExists;
}

void URakisWeatherSubsystem::WriteScalar(FName Name, float Value)
{
	if (MPCHasParam(Name, false))
	{
		UKismetMaterialLibrary::SetScalarParameterValue(this, WeatherMPC, Name, Value);
	}
}

void URakisWeatherSubsystem::WriteVector(FName Name, const FLinearColor& Value)
{
	if (MPCHasParam(Name, true))
	{
		UKismetMaterialLibrary::SetVectorParameterValue(this, WeatherMPC, Name, Value);
	}
}

void URakisWeatherSubsystem::WriteMPC()
{
	if (!WeatherMPC)
	{
		return;
	}
	using namespace RakisWeatherPrivate;

	WriteScalar(P_WindSpeed, GustedWindSpeed);
	WriteScalar(P_StormIntensity, Current.StormIntensity);
	WriteScalar(P_DustDensity, Current.DustDensity);
	// Внутри сиетча марева нет, даже если пресет ещё смешивается.
	WriteScalar(P_HeatHaze, Current.HeatHaze * (1.f - InteriorCurrent));
	WriteScalar(P_TimeOfDay01, Current.TimeOfDayHours / 24.f);
	WriteScalar(P_Interior01, InteriorCurrent);

	WriteVector(P_WindDirection, FLinearColor(GustedWindDirection.X, GustedWindDirection.Y, 0.f, GustedWindSpeed));
	WriteVector(P_SunDirection, FLinearColor(SunDirection.X, SunDirection.Y, SunDirection.Z, SunElevationDeg / 90.f));

	// Оттенок песка: тёплый от цвета солнца, «желтеет» в бурю. A = пыль.
	const FLinearColor SunTint = FMath::Lerp(FLinearColor::White, Current.SunColor, 0.35f);
	const FLinearColor StormTint = FMath::Lerp(FLinearColor::White, FLinearColor(1.f, 0.88f, 0.66f), Current.StormIntensity);
	FLinearColor SandTint = SunTint * StormTint;
	SandTint.A = Current.DustDensity;
	WriteVector(P_SandTint, SandTint);

	if (const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		const FVector P = Player->GetActorLocation();
		WriteVector(P_PlayerPosition, FLinearColor(P.X, P.Y, P.Z, 1.f));
	}
}
