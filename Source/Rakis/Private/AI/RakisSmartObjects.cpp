#include "AI/RakisSmartObjects.h"

#include "Rakis.h"
#include "RakisAIVisuals.h"

#include "Logging/TokenizedMessage.h"
#include "Misc/PackageName.h"
#include "UObject/Package.h"
#include "UObject/UnrealType.h"

namespace RakisAITags
{
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_Loom, "Rakis.SO.Loom", "Smart Object: ткацкий станок");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_Stall, "Rakis.SO.Stall", "Smart Object: прилавок");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_WaterJar, "Rakis.SO.WaterJar", "Smart Object: кувшин с водой");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_PrayerMat, "Rakis.SO.PrayerMat", "Smart Object: молитвенный коврик");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_Bench, "Rakis.SO.Bench", "Smart Object: скамья");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_Niche, "Rakis.SO.Niche", "Smart Object: ниша");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(SO_StillsuitRepair, "Rakis.SO.StillsuitRepair", "Smart Object: починка дистикомба");

	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Event_Ritual, "Rakis.Crowd.Event.Ritual", "StateTree: толпа идёт на ритуал");
	UE_DEFINE_GAMEPLAY_TAG_COMMENT(Event_PlayerBlocking, "Rakis.Crowd.Event.PlayerBlocking", "StateTree: игрок на пути горожанина");

	FGameplayTag GetSpotTypeTag(FName SpotType)
	{
		static const FName Loom(TEXT("Loom"));
		static const FName Stall(TEXT("Stall"));
		static const FName WaterJar(TEXT("WaterJar"));
		static const FName PrayerMat(TEXT("PrayerMat"));
		static const FName Bench(TEXT("Bench"));
		static const FName Niche(TEXT("Niche"));
		static const FName StillsuitRepair(TEXT("StillsuitRepair"));

		if (SpotType == Loom)            { return SO_Loom; }
		if (SpotType == Stall)           { return SO_Stall; }
		if (SpotType == WaterJar)        { return SO_WaterJar; }
		if (SpotType == PrayerMat)       { return SO_PrayerMat; }
		if (SpotType == Bench)           { return SO_Bench; }
		if (SpotType == Niche)           { return SO_Niche; }
		if (SpotType == StillsuitRepair) { return SO_StillsuitRepair; }
		return FGameplayTag();
	}
}

namespace RakisSmartObjects
{
	int32 GetSpotCapacity(FName SpotType)
	{
		static const FName Bench(TEXT("Bench"));
		static const FName Stall(TEXT("Stall"));
		static const FName WaterJar(TEXT("WaterJar"));
		if (SpotType == Bench) { return 3; }
		if (SpotType == Stall || SpotType == WaterJar) { return 2; }
		return 1;
	}

	FSoftObjectPath GetDefinitionAssetPath(FName SpotType)
	{
		const FString Name = FString::Printf(TEXT("SOD_%s"), *SpotType.ToString());
		return FSoftObjectPath(FString::Printf(TEXT("/Game/Rakis/AI/SmartObjects/%s.%s"), *Name, *Name));
	}

	/** Валидация определения (5.6: Validate(TArray<TPair<EMessageSeverity::Type, FText>>*)), ошибки — в лог. */
	static bool ValidateDefinition(const USmartObjectDefinition& Definition, FName SpotType)
	{
		TArray<TPair<EMessageSeverity::Type, FText>> Messages;
		const bool bOk = Definition.Validate(&Messages);
		for (const TPair<EMessageSeverity::Type, FText>& Msg : Messages)
		{
			if (Msg.Key == EMessageSeverity::Error)
			{
				UE_LOG(LogRakis, Warning, TEXT("Crowd SO %s: %s"), *SpotType.ToString(), *Msg.Value.ToString());
			}
		}
		return bOk;
	}

	/** Ассет годится, если у него есть слоты и (на определении или слоте) тег Rakis.SO.<Type>. */
	static bool IsAssetUsable(const USmartObjectDefinition& Definition, const FGameplayTag& TypeTag)
	{
		const TConstArrayView<FSmartObjectSlotDefinition> AssetSlots = Definition.GetSlots();
		if (AssetSlots.Num() == 0)
		{
			return false;
		}
		for (int32 Index = 0; Index < AssetSlots.Num(); ++Index)
		{
			FGameplayTagContainer SlotTags;
			Definition.GetSlotActivityTags(Index, SlotTags);
			if (!SlotTags.HasTagExact(TypeTag))
			{
				return false;
			}
		}
		return true;
	}

	/**
	 * Определение в рантайме. Массив Slots у USmartObjectDefinition приватный (публичного «добавить слот» вне
	 * отладочных сборок нет — DebugAddSlot тестовый), поэтому слоты добавляются через рефлексию UPROPERTY "Slots".
	 */
	static USmartObjectDefinition* BuildRuntimeDefinition(UObject* Outer, FName SpotType, const FGameplayTag& TypeTag)
	{
		const FName ObjName = MakeUniqueObjectName(Outer, USmartObjectDefinition::StaticClass(),
			FName(*FString::Printf(TEXT("SOD_%s_Runtime"), *SpotType.ToString())));
		USmartObjectDefinition* Definition = NewObject<USmartObjectDefinition>(Outer, ObjName, RF_Transient);

		FGameplayTagContainer ActivityTags;
		ActivityTags.AddTag(TypeTag);
		Definition->SetActivityTags(ActivityTags);

		FArrayProperty* SlotsProp = FindFProperty<FArrayProperty>(USmartObjectDefinition::StaticClass(), TEXT("Slots"));
		const FStructProperty* SlotStructProp = SlotsProp ? CastField<FStructProperty>(SlotsProp->Inner) : nullptr;
		if (!SlotsProp || !SlotStructProp || SlotStructProp->Struct != FSmartObjectSlotDefinition::StaticStruct())
		{
			RakisAIVisuals::WarnOnce(TEXT("SO.NoSlotsProp"),
				TEXT("Crowd: у USmartObjectDefinition нет UPROPERTY Slots нужного типа — рантайм-определения недоступны, нужны ассеты SOD_<Type>."));
			return nullptr;
		}
		const FStructProperty* IdProp = FindFProperty<FStructProperty>(FSmartObjectSlotDefinition::StaticStruct(), TEXT("ID"));

		const int32 Capacity = GetSpotCapacity(SpotType);
		const float Spacing = 70.f;
		FScriptArrayHelper Helper(SlotsProp, SlotsProp->ContainerPtrToValuePtr<void>(Definition));
		for (int32 Index = 0; Index < Capacity; ++Index)
		{
			const int32 NewIndex = Helper.AddValue();
			FSmartObjectSlotDefinition* Slot = reinterpret_cast<FSmartObjectSlotDefinition*>(Helper.GetRawPtr(NewIndex));

			// Слоты в ряд поперёк «лица» точки (локальная Y): скамья — трое плечом к плечу.
			const float Lateral = (static_cast<float>(Index) - 0.5f * static_cast<float>(Capacity - 1)) * Spacing;
			Slot->Offset = FVector3f(0.f, Lateral, 0.f);
			Slot->Rotation = FRotator3f::ZeroRotator;
			Slot->bEnabled = true;
			if (IdProp && IdProp->Struct == TBaseStructure<FGuid>::Get())
			{
				*IdProp->ContainerPtrToValuePtr<FGuid>(Slot) = FGuid::NewGuid();
			}

			URakisSmartObjectBehaviorDefinition* Behavior = NewObject<URakisSmartObjectBehaviorDefinition>(Definition, NAME_None, RF_Transient);
			Behavior->SpotType = SpotType;
			Behavior->TalkChanceScale = Capacity > 1 ? 1.3f : 1.f;
			Slot->BehaviorDefinitions.Add(Behavior);
		}

		ValidateDefinition(*Definition, SpotType);
		return Definition;
	}

	USmartObjectDefinition* LoadOrBuildDefinition(UObject* Outer, FName SpotType, bool& bOutFromAsset)
	{
		bOutFromAsset = false;
		const FGameplayTag TypeTag = RakisAITags::GetSpotTypeTag(SpotType);
		if (!TypeTag.IsValid() || !Outer)
		{
			return nullptr;
		}

		const FSoftObjectPath AssetPath = GetDefinitionAssetPath(SpotType);
		// Проверка пакета до загрузки — без «Failed to find object» в логе, когда ассетов ещё нет.
		if (FPackageName::DoesPackageExist(AssetPath.GetLongPackageName()))
		{
			if (USmartObjectDefinition* Asset = Cast<USmartObjectDefinition>(AssetPath.TryLoad()))
			{
				if (IsAssetUsable(*Asset, TypeTag) && ValidateDefinition(*Asset, SpotType))
				{
					bOutFromAsset = true;
					return Asset;
				}
				RakisAIVisuals::WarnOnce(FString::Printf(TEXT("SO.BadAsset.%s"), *SpotType.ToString()),
					FString::Printf(TEXT("Crowd: %s без слотов/тега %s или невалиден — используется рантайм-определение."),
						*AssetPath.ToString(), *TypeTag.ToString()));
			}
		}
		return BuildRuntimeDefinition(Outer, SpotType, TypeTag);
	}
}
