#include "Sand/RakisSandTrailSubsystem.h"

#include "Rakis.h"
#include "Core/RakisSettings.h"
#include "Core/RakisTypes.h"
#include "Noise/RakisNoiseSubsystem.h"
#include "Worm/RakisWorm.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/CapsuleComponent.h"
#include "Components/PrimitiveComponent.h"
#include "CoreGlobals.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/HitResult.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialParameterCollection.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "PhysicalMaterials/PhysicalMaterial.h"

namespace RakisSandTrailPrivate
{
	// Пути ассетов — синхронно с Tools/unreal_python/mat_sand_trails.py.
	static const TCHAR* NearRTPath = TEXT("/Game/Rakis/Materials/RT/RT_SandTrail.RT_SandTrail");
	static const TCHAR* FarRTPath = TEXT("/Game/Rakis/Materials/RT/RT_SandTrail_Far.RT_SandTrail_Far");
	static const TCHAR* StampPath = TEXT("/Game/Rakis/Materials/RT/M_SandTrail_Stamp.M_SandTrail_Stamp");
	static const TCHAR* FadePath = TEXT("/Game/Rakis/Materials/RT/M_SandTrail_Fade.M_SandTrail_Fade");
	static const TCHAR* CopyPath = TEXT("/Game/Rakis/Materials/RT/M_SandTrail_Copy.M_SandTrail_Copy");
	static const TCHAR* FallbackMPCPath = TEXT("/Game/Rakis/Materials/Functions/MPC_RakisWeather.MPC_RakisWeather");

	// Параметры материалов (контракт с mat_sand_trails.py).
	static const FName P_StampType(TEXT("StampType"));
	static const FName P_StampDepth(TEXT("StampDepthCm"));
	static const FName P_StampRim(TEXT("StampRimCm"));
	static const FName P_FadeAlpha(TEXT("FadeAlpha"));
	static const FName P_Source(TEXT("Source"));
	static const FName P_UVOffset(TEXT("UVOffset"));

	// MPC_RakisWeather (контракт §2.5 + T-017).
	static const FName P_TrailOrigin(TEXT("TrailOrigin"));
	static const FName P_TrailOriginFar(TEXT("TrailOriginFar"));
	static const FName P_WindSpeed(TEXT("WindSpeed"));
	static const FName P_StormIntensity(TEXT("StormIntensity"));

	// Источники шума (RakisCharacter.cpp / RakisThumper.cpp).
	static const FName FootstepSource(TEXT("Footstep"));
	static const FName ThumperSource(TEXT("Thumper"));

	/** Квад штампа больше формы в 1.3 раза (вал помещается) — то же число, что в RakisTrailStampShape. */
	static constexpr float StampQuadScale = 1.3f;

	static constexpr float Ln2 = 0.69314718f;

	static constexpr uint32 Bit(ERakisStampType Type) { return 1u << static_cast<uint32>(Type); }

	static TAutoConsoleVariable<int32> CVarSandTrails(
		TEXT("Rakis.SandTrails"), 1,
		TEXT("Следы на песке (URakisSandTrailSubsystem): 1 — вкл, 0 — выкл (RT не обновляются, ландшафт их не читает)."),
		ECVF_Scalability);

	static void ClearForWorld(UWorld* World)
	{
		if (URakisSandTrailSubsystem* Trails = World ? World->GetSubsystem<URakisSandTrailSubsystem>() : nullptr)
		{
			Trails->ClearTrails();
		}
	}

	static FAutoConsoleCommandWithWorld CmdClearTrails(
		TEXT("Rakis.SandTrails.Clear"),
		TEXT("Стереть все следы на песке."),
		FConsoleCommandWithWorldDelegate::CreateStatic(&ClearForWorld));
}

URakisSandTrailSubsystem::URakisSandTrailSubsystem()
{
	using namespace RakisSandTrailPrivate;
	NearTargetAsset = TSoftObjectPtr<UTextureRenderTarget2D>(FSoftObjectPath(NearRTPath));
	FarTargetAsset = TSoftObjectPtr<UTextureRenderTarget2D>(FSoftObjectPath(FarRTPath));
	StampMaterialAsset = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(StampPath));
	FadeMaterialAsset = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(FadePath));
	CopyMaterialAsset = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(CopyPath));
}

URakisSandTrailSubsystem* URakisSandTrailSubsystem::Get(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World ? World->GetSubsystem<URakisSandTrailSubsystem>() : nullptr;
}

bool URakisSandTrailSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	// На выделенном сервере рисовать некому.
	return Super::ShouldCreateSubsystem(Outer) && !IsRunningDedicatedServer();
}

bool URakisSandTrailSubsystem::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

void URakisSandTrailSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// Шаги игрока и удары тампера приходят из шумовой подсистемы (публичный нативный делегат).
	if (URakisNoiseSubsystem* Noise = Collection.InitializeDependency<URakisNoiseSubsystem>())
	{
		NoiseSource = Noise;
		NoiseHandle = Noise->OnNoiseReported.AddUObject(this, &URakisSandTrailSubsystem::HandleNoise);
	}
}

void URakisSandTrailSubsystem::Deinitialize()
{
	if (URakisNoiseSubsystem* Noise = NoiseSource.Get())
	{
		Noise->OnNoiseReported.Remove(NoiseHandle);
	}
	NoiseHandle.Reset();
	NoiseSource.Reset();
	Pending.Reset();
	Tracks.Reset();
	Cascades.Reset();
	StampMIDs.Reset();
	StampMaterial = nullptr;
	FadeMaterial = nullptr;
	CopyMaterial = nullptr;
	WeatherMPC = nullptr;
	bResourcesReady = false;

	Super::Deinitialize();
}

TStatId URakisSandTrailSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(URakisSandTrailSubsystem, STATGROUP_Tickables);
}

void URakisSandTrailSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	InitResources();
}

// ---------------------------------------------------------------------------------------------
// Ресурсы

bool URakisSandTrailSubsystem::InitResources()
{
	using namespace RakisSandTrailPrivate;
	bTriedInit = true;
	bResourcesReady = false;

	StampMaterial = StampMaterialAsset.LoadSynchronous();
	FadeMaterial = FadeMaterialAsset.LoadSynchronous();
	CopyMaterial = CopyMaterialAsset.LoadSynchronous();
	if (!StampMaterial || !FadeMaterial || !CopyMaterial)
	{
		UE_LOG(LogRakis, Warning, TEXT("SandTrail: нет M_SandTrail_Stamp/Fade/Copy (запустите mat_master_materials.py) — следы на песке выключены."));
		return false;
	}

	const URakisSettings* Settings = URakisSettings::Get();
	if (Settings && !Settings->WeatherMPC.IsNull())
	{
		WeatherMPC = Settings->WeatherMPC.LoadSynchronous();
	}
	if (!WeatherMPC)
	{
		WeatherMPC = LoadObject<UMaterialParameterCollection>(nullptr, FallbackMPCPath, nullptr, LOAD_NoWarning | LOAD_Quiet);
	}
	if (!WeatherMPC)
	{
		UE_LOG(LogRakis, Warning, TEXT("SandTrail: MPC_RakisWeather не найден — ландшафт не узнает окно RT (TrailOrigin)."));
	}

	Cascades.Reset();
	Cascades.SetNum(2);
	const uint32 NearMask = Bit(ERakisStampType::Footprint) | Bit(ERakisStampType::Sliding) | Bit(ERakisStampType::ThumperRing);
	const uint32 FarMask = Bit(ERakisStampType::WormFurrow) | Bit(ERakisStampType::WormCrater) | Bit(ERakisStampType::ThumperRing);
	const bool bNear = InitCascade(Cascades[0], NearTargetAsset, NearFallbackResolution, NearWorldSizeCm, NearSnapCm, P_TrailOrigin, 1.f, NearMask);
	const bool bFar = InitCascade(Cascades[1], FarTargetAsset, FarFallbackResolution, FarWorldSizeCm, FarSnapCm, P_TrailOriginFar, FarFadeRateScale, FarMask);
	bResourcesReady = bNear || bFar;

	if (bResourcesReady)
	{
		UE_LOG(LogRakis, Log, TEXT("SandTrail: каскады готовы (ближний %s %d², дальний %s %d²)."),
			bNear ? TEXT("да") : TEXT("нет"), Cascades[0].Resolution, bFar ? TEXT("да") : TEXT("нет"), Cascades[1].Resolution);
	}
	return bResourcesReady;
}

bool URakisSandTrailSubsystem::InitCascade(FRakisTrailCascade& Cascade, const TSoftObjectPtr<UTextureRenderTarget2D>& Asset,
	int32 FallbackResolution, float InWorldSizeCm, float InSnapCm, FName InMPCParameter, float InFadeRateScale, uint32 InAcceptMask)
{
	Cascade.MPCParameter = InMPCParameter;
	Cascade.WorldSizeCm = FMath::Max(InWorldSizeCm, 100.f);
	Cascade.FadeRateScale = InFadeRateScale;
	Cascade.AcceptMask = InAcceptMask;
	Cascade.bHasOrigin = false;
	Cascade.bValid = false;

	UTextureRenderTarget2D* Target = Asset.LoadSynchronous();
	if (!Target)
	{
		// Фоллбек: код живёт и рисует (отладка), но ландшафт ссылается на ассет — без него следов не видно.
		Target = UKismetRenderingLibrary::CreateRenderTarget2D(this, FallbackResolution, FallbackResolution, RTF_RG16f,
			FLinearColor::Transparent, false, false);
		UE_LOG(LogRakis, Warning, TEXT("SandTrail: ассет %s не найден — транзиентный RT (ландшафт его не видит; запустите mat_master_materials.py)."),
			*Asset.ToString());
	}
	if (!Target || Target->SizeX <= 0 || Target->SizeY <= 0)
	{
		return false;
	}
	if (Target->SizeX != Target->SizeY)
	{
		UE_LOG(LogRakis, Warning, TEXT("SandTrail: %s не квадратный (%dx%d) — используется SizeX."), *Target->GetName(), Target->SizeX, Target->SizeY);
	}
	if (Target->RenderTargetFormat != RTF_RG16f && Target->RenderTargetFormat != RTF_RGBA16f
		&& Target->RenderTargetFormat != RTF_RG32f && Target->RenderTargetFormat != RTF_RGBA32f)
	{
		UE_LOG(LogRakis, Warning, TEXT("SandTrail: %s не float-формата — глубины в см обрежутся до 0..1."), *Target->GetName());
	}

	Cascade.Target = Target;
	Cascade.Resolution = Target->SizeX;
	Cascade.SnapCm = SnapToTexel(InSnapCm, Cascade.GetTexelCm());
	Cascade.Scratch = UKismetRenderingLibrary::CreateRenderTarget2D(this, Target->SizeX, Target->SizeY, Target->RenderTargetFormat,
		FLinearColor::Transparent, false, false);

	Cascade.CopyToScratchMID = UMaterialInstanceDynamic::Create(CopyMaterial, this);
	Cascade.CopyBackMID = UMaterialInstanceDynamic::Create(CopyMaterial, this);
	Cascade.FadeMID = UMaterialInstanceDynamic::Create(FadeMaterial, this);
	if (!Cascade.Scratch || !Cascade.CopyToScratchMID || !Cascade.CopyBackMID || !Cascade.FadeMID)
	{
		return false;
	}

	using namespace RakisSandTrailPrivate;
	Cascade.CopyToScratchMID->SetTextureParameterValue(P_Source, Cascade.Target);
	Cascade.CopyBackMID->SetTextureParameterValue(P_Source, Cascade.Scratch);
	Cascade.CopyBackMID->SetVectorParameterValue(P_UVOffset, FLinearColor::Transparent);

	UKismetRenderingLibrary::ClearRenderTarget2D(this, Cascade.Target, FLinearColor::Transparent);
	UKismetRenderingLibrary::ClearRenderTarget2D(this, Cascade.Scratch, FLinearColor::Transparent);
	Cascade.bValid = true;
	return true;
}

UMaterialInstanceDynamic* URakisSandTrailSubsystem::GetStampMID(int32 Index)
{
	while (StampMIDs.Num() <= Index)
	{
		UMaterialInstanceDynamic* MID = UMaterialInstanceDynamic::Create(StampMaterial, this);
		if (!MID)
		{
			return nullptr;
		}
		StampMIDs.Add(MID);
	}
	return StampMIDs[Index];
}

void URakisSandTrailSubsystem::ClearTrails()
{
	for (FRakisTrailCascade& Cascade : Cascades)
	{
		if (Cascade.bValid)
		{
			UKismetRenderingLibrary::ClearRenderTarget2D(this, Cascade.Target, FLinearColor::Transparent);
		}
	}
	Pending.Reset();
	bWormStampValid = false;
}

// ---------------------------------------------------------------------------------------------
// Чистые функции

FVector2D URakisSandTrailSubsystem::WorldToPixel(const FVector2D& World, const FVector2D& Origin, float WorldSizeCm, int32 Resolution)
{
	const double Size = FMath::Max(static_cast<double>(WorldSizeCm), 1.0);
	return ((World - Origin) / Size + FVector2D(0.5, 0.5)) * static_cast<double>(FMath::Max(Resolution, 1));
}

float URakisSandTrailSubsystem::SnapToTexel(float SnapCm, float TexelCm)
{
	const float Texel = FMath::Max(TexelCm, UE_KINDA_SMALL_NUMBER);
	return FMath::Max(1.f, FMath::RoundToFloat(SnapCm / Texel)) * Texel;
}

FVector2D URakisSandTrailSubsystem::ComputeSnappedOrigin(const FVector2D& Focus, float SnapCm)
{
	const double Snap = FMath::Max(static_cast<double>(SnapCm), 1.0);
	return FVector2D(FMath::RoundToDouble(Focus.X / Snap) * Snap, FMath::RoundToDouble(Focus.Y / Snap) * Snap);
}

bool URakisSandTrailSubsystem::NeedsRecenter(const FVector2D& Focus, const FVector2D& Origin, float SnapCm)
{
	return FMath::Abs(Focus.X - Origin.X) > SnapCm || FMath::Abs(Focus.Y - Origin.Y) > SnapCm;
}

float URakisSandTrailSubsystem::ComputeFadeAlpha(float DeltaSeconds, float WindSpeed, float StormIntensity,
	float InCalmHalfLifeSec, float InWindReferenceMs, float InStormHalfLifeSec)
{
	if (DeltaSeconds <= 0.f)
	{
		return 0.f;
	}
	const float WindTerm = 1.f + FMath::Max(WindSpeed, 0.f) / FMath::Max(InWindReferenceMs, 0.1f);
	using RakisSandTrailPrivate::Ln2;
	const float Rate = Ln2 / FMath::Max(InCalmHalfLifeSec, 0.1f) * WindTerm
		+ FMath::Clamp(StormIntensity, 0.f, 1.f) * Ln2 / FMath::Max(InStormHalfLifeSec, 0.1f);
	return FMath::Clamp(1.f - FMath::Exp(-Rate * DeltaSeconds), 0.f, 1.f);
}

int32 URakisSandTrailSubsystem::ClassifySandHit(const FHitResult& Hit)
{
	static const FName TagSand(TEXT("Rakis.Surface.Sand"));
	static const FName TagPacked(TEXT("Rakis.Surface.PackedSand"));
	static const FString TagPrefix(TEXT("Rakis.Surface."));

	// Те же теги, что у ARakisCharacter (SurfaceTagPrefix): тег важнее физматериала.
	auto CheckTags = [](const TArray<FName>& Tags, int32& Out) -> bool
	{
		for (const FName& Tag : Tags)
		{
			if (Tag == TagSand) { Out = 1; return true; }
			if (Tag == TagPacked) { Out = 2; return true; }
			if (Tag.ToString().StartsWith(TagPrefix)) { Out = 0; return true; }
		}
		return false;
	};

	const UPrimitiveComponent* Component = Hit.GetComponent();
	const AActor* Actor = Hit.GetActor();
	int32 Tagged = 0;
	if ((Component && CheckTags(Component->ComponentTags, Tagged)) || (Actor && CheckTags(Actor->Tags, Tagged)))
	{
		return Tagged;
	}

	// SurfaceType1..6 — Config/DefaultEngine.ini (Sand, Rock, SietchStone, Cloth, Metal, PackedSand).
	switch (UPhysicalMaterial::DetermineSurfaceType(Hit.PhysMaterial.Get()))
	{
	case SurfaceType1: return 1;
	case SurfaceType6: return 2;
	case SurfaceType_Default: break;
	default: return 0;
	}

	// Физматериал не задан: ландшафт пустыни считаем песком (как DefaultSurface персонажа), прочее — нет.
	return (Component && Component->GetClass()->GetName().Contains(TEXT("Landscape"))) ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Тик

bool URakisSandTrailSubsystem::GetFocus(FVector& OutFocus) const
{
	if (const APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		OutFocus = Pawn->GetActorLocation();
		return true;
	}
	if (const APlayerCameraManager* Camera = UGameplayStatics::GetPlayerCameraManager(this, 0))
	{
		OutFocus = Camera->GetCameraLocation();
		return true;
	}
	return false;
}

void URakisSandTrailSubsystem::Tick(float DeltaTime)
{
	UWorld* World = GetWorld();
	if (!World || !World->HasBegunPlay())
	{
		return;
	}
	if (!bResourcesReady)
	{
		if (!bTriedInit)
		{
			InitResources();
		}
		if (!bResourcesReady)
		{
			return;
		}
	}

	const bool bEnabled = RakisSandTrailPrivate::CVarSandTrails.GetValueOnGameThread() != 0;
	if (!bEnabled)
	{
		if (bWasEnabled)
		{
			// Выключили — ландшафт перестаёт сэмплировать RT (w = 0 в MPC).
			for (const FRakisTrailCascade& Cascade : Cascades)
			{
				WriteWindowToMPC(Cascade, false);
			}
			bWasEnabled = false;
		}
		Pending.Reset();
		return;
	}
	if (!bWasEnabled)
	{
		bWasEnabled = true;
		ClearTrails();
		for (FRakisTrailCascade& Cascade : Cascades)
		{
			Cascade.bHasOrigin = false;  // пересоздать окно
		}
	}

	FVector Focus;
	if (!GetFocus(Focus))
	{
		return;
	}

	for (FRakisTrailCascade& Cascade : Cascades)
	{
		UpdateWindow(Cascade, FVector2D(Focus.X, Focus.Y));
	}

	// MPC-инстанс мира живёт долго, но после стриминга/смены пресета его могли переписать — раз в секунду.
	MPCRefreshAccum += DeltaTime;
	if (MPCRefreshAccum >= 1.f)
	{
		MPCRefreshAccum = 0.f;
		for (const FRakisTrailCascade& Cascade : Cascades)
		{
			WriteWindowToMPC(Cascade, Cascade.bValid);
		}
	}

	ScanAccum += DeltaTime;
	if (ScanAccum >= 1.f / FMath::Max(ScanHz, 1.f))
	{
		ScanAccum = 0.f;
		ScanCharacters(Focus);
		UpdateWorm(Focus);
	}

	FadeAccum += DeltaTime;
	if (FadeAccum >= FadeInterval)
	{
		ApplyFade(FadeAccum);
		FadeAccum = 0.f;
	}

	FlushStamps();
}

void URakisSandTrailSubsystem::UpdateWindow(FRakisTrailCascade& Cascade, const FVector2D& Focus)
{
	if (!Cascade.bValid)
	{
		return;
	}

	const FVector2D NewOrigin = ComputeSnappedOrigin(Focus, Cascade.SnapCm);
	if (!Cascade.bHasOrigin)
	{
		Cascade.Origin = NewOrigin;
		Cascade.bHasOrigin = true;
		UKismetRenderingLibrary::ClearRenderTarget2D(this, Cascade.Target, FLinearColor::Transparent);
		WriteWindowToMPC(Cascade, true);
		return;
	}
	if (!NeedsRecenter(Focus, Cascade.Origin, Cascade.SnapCm))
	{
		return;
	}

	const FVector2D Delta = NewOrigin - Cascade.Origin;
	if (FMath::Abs(Delta.X) >= Cascade.WorldSizeCm || FMath::Abs(Delta.Y) >= Cascade.WorldSizeCm)
	{
		// Телепорт/стриминг: старое окно целиком вне нового.
		UKismetRenderingLibrary::ClearRenderTarget2D(this, Cascade.Target, FLinearColor::Transparent);
	}
	else
	{
		// Скролл: Target --(UV + Delta/Size)--> Scratch --> Target. Delta кратна текселю — выборка точная.
		using namespace RakisSandTrailPrivate;
		const FLinearColor Offset(static_cast<float>(Delta.X / Cascade.WorldSizeCm), static_cast<float>(Delta.Y / Cascade.WorldSizeCm), 0.f, 0.f);
		Cascade.CopyToScratchMID->SetVectorParameterValue(P_UVOffset, Offset);
		UKismetRenderingLibrary::DrawMaterialToRenderTarget(this, Cascade.Scratch, Cascade.CopyToScratchMID);
		UKismetRenderingLibrary::DrawMaterialToRenderTarget(this, Cascade.Target, Cascade.CopyBackMID);
	}
	Cascade.Origin = NewOrigin;
	WriteWindowToMPC(Cascade, true);
}

void URakisSandTrailSubsystem::WriteWindowToMPC(const FRakisTrailCascade& Cascade, bool bActive)
{
	UWorld* World = GetWorld();
	if (!World || !WeatherMPC || Cascade.MPCParameter.IsNone())
	{
		return;
	}
	UMaterialParameterCollectionInstance* Instance = World->GetParameterCollectionInstance(WeatherMPC);
	if (!Instance)
	{
		return;
	}
	const FLinearColor Value(static_cast<float>(Cascade.Origin.X), static_cast<float>(Cascade.Origin.Y), Cascade.WorldSizeCm,
		(bActive && Cascade.bValid && Cascade.bHasOrigin) ? 1.f : 0.f);
	if (!Instance->SetVectorParameterValue(Cascade.MPCParameter, Value) && !bWarnedNoMPCParam)
	{
		bWarnedNoMPCParam = true;
		UE_LOG(LogRakis, Warning, TEXT("SandTrail: в %s нет параметра %s — перезапустите mat_master_materials.py (T-017)."),
			*WeatherMPC->GetName(), *Cascade.MPCParameter.ToString());
	}
}

float URakisSandTrailSubsystem::ReadMPCScalar(FName Name, float Default) const
{
	UWorld* World = GetWorld();
	if (!World || !WeatherMPC)
	{
		return Default;
	}
	UMaterialParameterCollectionInstance* Instance = World->GetParameterCollectionInstance(WeatherMPC);
	float Value = Default;
	return (Instance && Instance->GetScalarParameterValue(Name, Value)) ? Value : Default;
}

void URakisSandTrailSubsystem::ApplyFade(float DeltaSeconds)
{
	using namespace RakisSandTrailPrivate;
	const float Wind = ReadMPCScalar(P_WindSpeed, 3.5f);
	const float Storm = ReadMPCScalar(P_StormIntensity, 0.f);
	for (FRakisTrailCascade& Cascade : Cascades)
	{
		if (!Cascade.bValid || !Cascade.bHasOrigin)
		{
			continue;
		}
		const float Alpha = ComputeFadeAlpha(DeltaSeconds * Cascade.FadeRateScale, Wind, Storm, CalmHalfLifeSec, WindReferenceMs, StormHalfLifeSec);
		if (Alpha <= 0.f)
		{
			continue;
		}
		Cascade.FadeMID->SetScalarParameterValue(P_FadeAlpha, Alpha);
		UKismetRenderingLibrary::DrawMaterialToRenderTarget(this, Cascade.Target, Cascade.FadeMID);
	}
}

// ---------------------------------------------------------------------------------------------
// Штампы

void URakisSandTrailSubsystem::GetTypeShape(ERakisStampType Type, float& OutDepthCm, float& OutRimCm, float& OutWidthScale) const
{
	OutWidthScale = 1.f;
	switch (Type)
	{
	case ERakisStampType::Footprint:	OutDepthCm = FootprintDepthCm; OutRimCm = FootprintRimCm; OutWidthScale = 0.55f; break;
	case ERakisStampType::Sliding:		OutDepthCm = SlidingDepthCm; OutRimCm = SlidingRimCm; OutWidthScale = 0.5f; break;
	case ERakisStampType::WormFurrow:	OutDepthCm = WormFurrowDepthCm; OutRimCm = WormFurrowRimCm; break;
	case ERakisStampType::ThumperRing:	OutDepthCm = ThumperDepthCm; OutRimCm = ThumperRimCm; break;
	case ERakisStampType::WormCrater:	OutDepthCm = WormCraterDepthCm; OutRimCm = WormCraterRimCm; break;
	default:							OutDepthCm = 0.f; OutRimCm = 0.f; break;
	}
}

void URakisSandTrailSubsystem::AddStamp(const FVector& WorldPos, float RadiusCm, float Depth01, float YawDeg, ERakisStampType Type)
{
	if (!bResourcesReady || RakisSandTrailPrivate::CVarSandTrails.GetValueOnGameThread() == 0)
	{
		return;
	}
	if (Pending.Num() >= MaxStampsPerFrame * 4)
	{
		return;  // защита от лавины вызовов за кадр
	}
	float DepthCm = 0.f;
	float RimCm = 0.f;
	float WidthScale = 1.f;
	GetTypeShape(Type, DepthCm, RimCm, WidthScale);
	const float Strength = FMath::Clamp(Depth01, 0.f, 1.f);

	FPendingStamp& Stamp = Pending.AddDefaulted_GetRef();
	Stamp.Position = FVector2D(WorldPos.X, WorldPos.Y);
	Stamp.RadiusCm = FMath::Max(RadiusCm, 1.f);
	Stamp.DepthCm = DepthCm * Strength;
	Stamp.RimCm = RimCm * Strength;
	Stamp.YawDeg = YawDeg;
	Stamp.Type = Type;
}

void URakisSandTrailSubsystem::FlushStamps()
{
	if (Pending.IsEmpty())
	{
		return;
	}
	for (FRakisTrailCascade& Cascade : Cascades)
	{
		int32 MIDIndex = 0;
		DrawStamps(Cascade, MIDIndex);
	}
	Pending.Reset();
}

void URakisSandTrailSubsystem::DrawStamps(FRakisTrailCascade& Cascade, int32& InOutMIDIndex)
{
	using namespace RakisSandTrailPrivate;
	if (!Cascade.bValid || !Cascade.bHasOrigin)
	{
		return;
	}

	const float PxPerCm = static_cast<float>(Cascade.Resolution) / Cascade.WorldSizeCm;
	const float HalfWindow = Cascade.WorldSizeCm * 0.5f;

	UCanvas* Canvas = nullptr;
	FVector2D CanvasSize = FVector2D::ZeroVector;
	FDrawToRenderTargetContext Context;
	bool bBegun = false;

	for (const FPendingStamp& Stamp : Pending)
	{
		if (!Cascade.Accepts(Stamp.Type) || InOutMIDIndex >= MaxStampsPerFrame)
		{
			continue;
		}
		const float HalfExtent = Stamp.RadiusCm * StampQuadScale;
		if (HalfExtent * 2.f * PxPerCm < MinStampTexels)
		{
			continue;  // меньше текселя каскада — не видно
		}
		const FVector2D Local = Stamp.Position - Cascade.Origin;
		if (FMath::Abs(Local.X) > HalfWindow + HalfExtent || FMath::Abs(Local.Y) > HalfWindow + HalfExtent)
		{
			continue;  // вне окна
		}

		if (!bBegun)
		{
			UKismetRenderingLibrary::BeginDrawCanvasToRenderTarget(this, Cascade.Target, Canvas, CanvasSize, Context);
			bBegun = true;
			if (!Canvas)
			{
				break;
			}
		}

		// Свой MID на каждый штамп пачки: Canvas рендерит при EndDraw, параметры одного MID «схлопнулись» бы.
		UMaterialInstanceDynamic* MID = GetStampMID(InOutMIDIndex++);
		if (!MID)
		{
			break;
		}
		float DepthUnused = 0.f;
		float RimUnused = 0.f;
		float WidthScale = 1.f;
		GetTypeShape(Stamp.Type, DepthUnused, RimUnused, WidthScale);
		MID->SetScalarParameterValue(P_StampType, static_cast<float>(static_cast<uint8>(Stamp.Type)));
		MID->SetScalarParameterValue(P_StampDepth, Stamp.DepthCm);
		MID->SetScalarParameterValue(P_StampRim, Stamp.RimCm);

		const FVector2D QuadSize(2.f * HalfExtent * PxPerCm, 2.f * HalfExtent * WidthScale * PxPerCm);
		const FVector2D Center = WorldToPixel(Stamp.Position, Cascade.Origin, Cascade.WorldSizeCm, Cascade.Resolution);
		// Поворот вокруг центра квада. Экран: +X → u, +Y → v (вниз) = мировые +X/+Y, поэтому угол = мировой yaw.
		Canvas->K2_DrawMaterial(MID, Center - QuadSize * 0.5, QuadSize, FVector2D::ZeroVector, FVector2D::UnitVector,
			Stamp.YawDeg, FVector2D(0.5, 0.5));
	}

	if (bBegun)
	{
		UKismetRenderingLibrary::EndDrawCanvasToRenderTarget(this, Context);
	}
}

// ---------------------------------------------------------------------------------------------
// Источники

bool URakisSandTrailSubsystem::TraceSand(const FVector& Where, const AActor* Ignore, int32& OutSandKind) const
{
	OutSandKind = 0;
	UWorld* World = GetWorld();
	if (!World)
	{
		return false;
	}
	FCollisionQueryParams Params(SCENE_QUERY_STAT(RakisSandTrailTrace), false, Ignore);
	Params.bReturnPhysicalMaterial = true;
	FHitResult Hit;
	if (!World->LineTraceSingleByChannel(Hit, Where + FVector(0.f, 0.f, 100.f), Where - FVector(0.f, 0.f, 200.f), ECC_Visibility, Params))
	{
		return false;
	}
	OutSandKind = ClassifySandHit(Hit);
	return OutSandKind > 0;
}

void URakisSandTrailSubsystem::AddFootprint(const FVector& FootPos, float YawDeg, float Depth01, const AActor* Ignore)
{
	int32 SandKind = 0;
	if (!TraceSand(FootPos, Ignore, SandKind))
	{
		return;  // камень, пол сиетча — следов нет
	}
	const float Scale = SandKind == 2 ? PackedSandDepthScale : 1.f;
	AddStamp(FootPos, FootprintRadiusCm, Depth01 * Scale, YawDeg, ERakisStampType::Footprint);
}

void URakisSandTrailSubsystem::HandleNoise(const FRakisNoiseEvent& Event)
{
	using namespace RakisSandTrailPrivate;
	if (!bResourcesReady)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	if (Event.Source == FootstepSource)
	{
		// Кто шагнул: ближайший персонаж к точке стопы (в пределах 2 м). Направление — по скорости, иначе по yaw.
		ACharacter* Best = nullptr;
		double BestDistSq = FMath::Square(200.0);
		for (TActorIterator<ACharacter> It(World); It; ++It)
		{
			const double DistSq = FVector::DistSquared2D(It->GetActorLocation(), Event.Location);
			if (DistSq < BestDistSq)
			{
				BestDistSq = DistSq;
				Best = *It;
			}
		}
		float Yaw = 0.f;
		if (Best)
		{
			const FVector Velocity = Best->GetVelocity();
			Yaw = Velocity.SizeSquared2D() > FMath::Square(10.f) ? static_cast<float>(Velocity.Rotation().Yaw) : static_cast<float>(Best->GetActorRotation().Yaw);
			Tracks.FindOrAdd(Best).LastNoiseFootstepTime = World->GetTimeSeconds();
		}
		// Громкость уже учитывает походку (бег громче и глубже, походка по песку — мелкие следы).
		const float Depth01 = FMath::Lerp(0.6f, 1.f, FMath::Clamp(Event.Loudness, 0.f, 1.f));
		AddFootprint(Event.Location, Yaw, Depth01, Best);
	}
	else if (Event.Source == ThumperSource)
	{
		AddStamp(Event.Location, ThumperRingRadiusCm, 1.f, 0.f, ERakisStampType::ThumperRing);
	}
}

void URakisSandTrailSubsystem::ScanCharacters(const FVector& Focus)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	const double RadiusSq = FMath::Square(static_cast<double>(ScanRadiusCm));
	const float Step = FMath::Max(NpcStepCm, 10.f);

	for (TActorIterator<ACharacter> It(World); It; ++It)
	{
		ACharacter* Character = *It;
		if (!IsValid(Character))
		{
			continue;
		}
		const FVector Location = Character->GetActorLocation();
		if (FVector::DistSquared2D(Location, Focus) > RadiusSq)
		{
			continue;
		}

		FCharacterTrack& Track = Tracks.FindOrAdd(Character);
		const UCharacterMovementComponent* Move = Character->GetCharacterMovement();
		if (!Move || !Move->IsMovingOnGround())
		{
			Track.bInitialized = false;  // прыжок/падение/езда на черве — следующий след с места приземления
			continue;
		}
		const UCapsuleComponent* Capsule = Character->GetCapsuleComponent();
		const float HalfHeight = Capsule ? Capsule->GetScaledCapsuleHalfHeight() : 90.f;
		const FVector Foot = Location - FVector(0.f, 0.f, HalfHeight);
		if (!Track.bInitialized)
		{
			Track.LastFoot = Foot;
			Track.bInitialized = true;
			continue;
		}

		FVector Delta = Foot - Track.LastFoot;
		const float Drop = static_cast<float>(-Delta.Z);
		Delta.Z = 0.0;
		const float Dist = static_cast<float>(Delta.Size());
		if (Dist > Step * 8.f)
		{
			Track.LastFoot = Foot;  // телепорт
			continue;
		}
		if (Dist < Step)
		{
			continue;
		}

		const FVector Dir = Delta / Dist;
		const FVector Right(-Dir.Y, Dir.X, 0.0);
		const float Yaw = static_cast<float>(Dir.Rotation().Yaw);
		const float Speed = static_cast<float>(Character->GetVelocity().Size2D());
		const bool bSliding = Drop / Dist > SlideSlope && Speed >= SlideMinSpeed;
		const bool bHasNoiseSteps = Now - Track.LastNoiseFootstepTime < NoiseFootstepGraceSec;
		const float Depth01 = FMath::Lerp(0.6f, 1.f, FMath::Clamp(Speed / 600.f, 0.f, 1.f));
		const int32 Steps = FMath::FloorToInt(Dist / Step);

		for (int32 Index = 1; Index <= Steps; ++Index)
		{
			const FVector Point = Track.LastFoot + Dir * (Step * Index);
			if (bSliding)
			{
				int32 SandKind = 0;
				if (TraceSand(Point, Character, SandKind))
				{
					AddStamp(Point, 30.f, SandKind == 2 ? PackedSandDepthScale : 1.f, Yaw, ERakisStampType::Sliding);
				}
			}
			else if (!bHasNoiseSteps)
			{
				const FVector Lateral = Right * (Track.bNextLeft ? -FootLateralCm : FootLateralCm);
				Track.bNextLeft = !Track.bNextLeft;
				AddFootprint(Point + Lateral, Yaw, Depth01, Character);
			}
		}
		Track.LastFoot += Dir * (Step * Steps);
		Track.LastFoot.Z = Foot.Z;
	}

	for (auto It = Tracks.CreateIterator(); It; ++It)
	{
		if (!It.Key().IsValid())
		{
			It.RemoveCurrent();
		}
	}
}

void URakisSandTrailSubsystem::UpdateWorm(const FVector& Focus)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Now = World->GetTimeSeconds();
	if (!Worm.IsValid())
	{
		if (Now < NextWormSearchTime)
		{
			return;
		}
		NextWormSearchTime = Now + 2.f;
		for (TActorIterator<ARakisWorm> It(World); It; ++It)
		{
			Worm = *It;
			break;
		}
		bWormStampValid = false;
		if (!Worm.IsValid())
		{
			return;
		}
	}

	const ARakisWorm* WormActor = Worm.Get();
	const ERakisWormState State = WormActor->GetState();
	const FVector Head = WormActor->GetHeadLocation();
	const float GroundZ = WormActor->GetGroundZ();
	const FVector2D Head2D(Head.X, Head.Y);
	if (FVector2D::DistSquared(Head2D, FVector2D(Focus.X, Focus.Y)) > FMath::Square(static_cast<double>(FarWorldSizeCm)))
	{
		// Далеко от окон: штамп всё равно отсечётся. Колея продолжится с места входа в окно.
		LastWormState = static_cast<uint8>(State);
		bWormStampValid = false;
		return;
	}

	// Выход на поверхность — кратер (один раз на вход в Surface).
	if (State == ERakisWormState::Surface && LastWormState != static_cast<uint8>(ERakisWormState::Surface))
	{
		AddStamp(FVector(Head.X, Head.Y, GroundZ), WormCraterRadiusCm, 1.f, 0.f, ERakisStampType::WormCrater);
	}
	LastWormState = static_cast<uint8>(State);

	const bool bMoving = State == ERakisWormState::Approach || State == ERakisWormState::Surface
		|| State == ERakisWormState::Ridden || State == ERakisWormState::Pass;
	const float Below = GroundZ - static_cast<float>(Head.Z);
	if (!bMoving || Below > WormMaxDisturbDepthCm)
	{
		bWormStampValid = false;
		return;
	}

	const float Depth01 = FMath::Clamp(1.f - FMath::Max(Below, 0.f) / FMath::Max(WormMaxDisturbDepthCm, 1.f), 0.3f, 1.f);
	const float Spacing = FMath::Max(WormFurrowRadiusCm * 0.5f, 50.f);
	if (!bWormStampValid)
	{
		AddStamp(FVector(Head.X, Head.Y, GroundZ), WormFurrowRadiusCm, Depth01, 0.f, ERakisStampType::WormFurrow);
		LastWormStamp = Head2D;
		bWormStampValid = true;
		return;
	}

	const FVector2D Delta = Head2D - LastWormStamp;
	const float Dist = static_cast<float>(Delta.Size());
	if (Dist > WormFurrowRadiusCm * 10.f)
	{
		LastWormStamp = Head2D;  // ForceSurface/телепорт — без «перемычки» через полкарты
		return;
	}
	if (Dist < Spacing)
	{
		return;
	}
	const FVector2D Dir = Delta / Dist;
	const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(static_cast<float>(Dir.Y), static_cast<float>(Dir.X)));
	const int32 Steps = FMath::FloorToInt(Dist / Spacing);
	for (int32 Index = 1; Index <= Steps; ++Index)
	{
		const FVector2D Point = LastWormStamp + Dir * (Spacing * Index);
		AddStamp(FVector(Point.X, Point.Y, GroundZ), WormFurrowRadiusCm, Depth01, Yaw, ERakisStampType::WormFurrow);
	}
	LastWormStamp += Dir * (Spacing * Steps);
}
