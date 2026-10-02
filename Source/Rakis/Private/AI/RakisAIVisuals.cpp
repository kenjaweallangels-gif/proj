#include "RakisAIVisuals.h"

#include "Rakis.h"

#include "Animation/AnimInstance.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Character.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Math/RandomStream.h"

namespace RakisAIVisuals
{
	const TCHAR* PlaceholderMeshPath = TEXT("/Engine/BasicShapes/Cylinder.Cylinder");

	void WarnOnce(const FString& Key, const FString& Message)
	{
		static TSet<FString> Warned;
		if (!Warned.Contains(Key))
		{
			Warned.Add(Key);
			UE_LOG(LogRakis, Warning, TEXT("%s"), *Message);
		}
	}

	static USkeletalMesh* TryLoadSkeletalMesh(const FString& Path)
	{
		if (Path.IsEmpty())
		{
			return nullptr;
		}
		USkeletalMesh* Mesh = Cast<USkeletalMesh>(FSoftObjectPath(Path).TryLoad());
		if (!Mesh)
		{
			WarnOnce(Path, FString::Printf(TEXT("AI: скелетный меш '%s' не найден."), *Path));
		}
		return Mesh;
	}

	bool ApplyBody(ACharacter* Character, const FString& ArchetypeMeshPath, const FSoftObjectPath& FallbackMesh,
		const TSoftClassPtr<UAnimInstance>& AnimClass, const TSoftClassPtr<UAnimInstance>& FallbackAnim,
		UStaticMeshComponent* Placeholder)
	{
		if (!Character)
		{
			return false;
		}
		USkeletalMeshComponent* MeshComp = Character->GetMesh();

		// Уже есть меш (BP-наследник задал его в деталях) — не трогаем.
		USkeletalMesh* Mesh = MeshComp ? MeshComp->GetSkeletalMeshAsset() : nullptr;
		bool bUsedFallbackMesh = false;
		if (!Mesh)
		{
			Mesh = TryLoadSkeletalMesh(ArchetypeMeshPath);
			if (!Mesh && FallbackMesh.IsValid())
			{
				Mesh = TryLoadSkeletalMesh(FallbackMesh.ToString());
				bUsedFallbackMesh = Mesh != nullptr;
			}
			if (Mesh && MeshComp)
			{
				MeshComp->SetSkeletalMeshAsset(Mesh);
			}
		}

		if (Mesh && MeshComp)
		{
			UClass* Anim = nullptr;
			if (!AnimClass.IsNull())
			{
				Anim = AnimClass.LoadSynchronous();
				if (!Anim)
				{
					WarnOnce(AnimClass.ToString(), FString::Printf(TEXT("AI: анимкласс '%s' не найден."), *AnimClass.ToString()));
				}
			}
			if (!Anim && bUsedFallbackMesh && !FallbackAnim.IsNull())
			{
				Anim = FallbackAnim.LoadSynchronous();
				if (!Anim)
				{
					WarnOnce(FallbackAnim.ToString(), FString::Printf(TEXT("AI: фоллбек-анимкласс '%s' не найден."), *FallbackAnim.ToString()));
				}
			}
			if (Anim && MeshComp->GetAnimClass() != Anim)
			{
				MeshComp->SetAnimationMode(EAnimationMode::AnimationBlueprint);
				MeshComp->SetAnimInstanceClass(Anim);
			}
			if (Placeholder)
			{
				Placeholder->SetVisibility(false);
				Placeholder->SetHiddenInGame(true);
			}
			return true;
		}

		// Заглушка: цилиндр по размеру капсулы.
		if (Placeholder)
		{
			if (!Placeholder->GetStaticMesh())
			{
				if (UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, PlaceholderMeshPath))
				{
					Placeholder->SetStaticMesh(Cylinder);
				}
			}
			float Radius = 34.f;
			float HalfHeight = 90.f;
			if (const UCapsuleComponent* Capsule = Character->GetCapsuleComponent())
			{
				Radius = Capsule->GetUnscaledCapsuleRadius();
				HalfHeight = Capsule->GetUnscaledCapsuleHalfHeight();
			}
			// Цилиндр движка — 100×100×100 см с центром в начале координат.
			Placeholder->SetRelativeScale3D(FVector(Radius * 2.f / 100.f, Radius * 2.f / 100.f, HalfHeight * 2.f / 100.f));
			Placeholder->SetRelativeLocation(FVector::ZeroVector);
			Placeholder->SetHiddenInGame(false);
			Placeholder->SetVisibility(true);
		}
		WarnOnce(TEXT("AI.Placeholder"), TEXT("AI: скелетные меши недоступны — горожане/спутники отображаются заглушками."));
		return false;
	}

	void ApplyTint(ACharacter* Character, UStaticMeshComponent* Placeholder, const FLinearColor& Color, FName ParamName,
		TArray<TObjectPtr<UMaterialInstanceDynamic>>& OutMIDs)
	{
		OutMIDs.Reset();
		static const FName BasicShapeColor(TEXT("Color"));

		auto TintComponent = [&](UMeshComponent* Comp, bool bPlaceholder)
		{
			if (!Comp || !Comp->IsVisible())
			{
				return;
			}
			const int32 Num = Comp->GetNumMaterials();
			for (int32 i = 0; i < Num; ++i)
			{
				UMaterialInterface* Base = Comp->GetMaterial(i);
				if (!Base)
				{
					continue;
				}
				UMaterialInstanceDynamic* MID = Cast<UMaterialInstanceDynamic>(Base);
				if (!MID)
				{
					MID = Comp->CreateDynamicMaterialInstance(i, Base);
				}
				if (MID)
				{
					MID->SetVectorParameterValue(ParamName, Color);
					if (bPlaceholder)
					{
						MID->SetVectorParameterValue(BasicShapeColor, Color);
					}
					OutMIDs.Add(MID);
				}
			}
		};

		if (Character)
		{
			TintComponent(Character->GetMesh(), false);
		}
		TintComponent(Placeholder, true);
	}

	FLinearColor PickPaletteColor(const FString& Palette, FRandomStream& Rng, const FLinearColor& Default)
	{
		TArray<FString> Parts;
		Palette.ParseIntoArray(Parts, TEXT(";"), true);
		if (Parts.Num() == 0)
		{
			return Default;
		}
		const FString& Hex = Parts[Rng.RandRange(0, Parts.Num() - 1)];
		const FColor SRGB = FColor::FromHex(Hex.TrimStartAndEnd());
		// Лёгкий разброс яркости — ткани выгорают неравномерно.
		FLinearColor Linear(SRGB);
		Linear *= Rng.FRandRange(0.85f, 1.1f);
		Linear.A = 1.f;
		return Linear;
	}
}
