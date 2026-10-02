using UnrealBuildTool;

public class Rakis : ModuleRules
{
	public Rakis(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		CppStandard = CppStandardVersion.Cpp20;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput",
			"GameplayTags", "DeveloperSettings",
			"UMG", "Slate", "SlateCore",
			"Niagara", "AudioMixer", "MetasoundEngine", "AudioModulation",
			"StateTreeModule", "GameplayStateTreeModule",
			"SmartObjectsModule", "AIModule", "NavigationSystem",
			"LevelSequence", "MovieScene",
			"MassEntity", "MassCommon", "MassSpawner", "MassActors",
			"RenderCore", "Renderer", "Projects"
		});

		PrivateDependencyModuleNames.AddRange(new string[] { "ApplicationCore" });
	}
}
