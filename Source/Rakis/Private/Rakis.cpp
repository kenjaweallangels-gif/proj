#include "Rakis.h"

#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "ShaderCore.h"

DEFINE_LOG_CATEGORY(LogRakis);

/**
 * Игровой модуль Rakis.
 * На PostConfigInit регистрирует виртуальную папку шейдеров /Project/Rakis -> Source/Rakis/Shaders,
 * чтобы Custom-ноды материалов могли делать #include "/Project/Rakis/HeatHaze.ush".
 */
class FRakisModule final : public FDefaultGameModuleImpl
{
public:
	virtual void StartupModule() override
	{
		const FString ShaderDir = FPaths::Combine(FPaths::ProjectDir(), TEXT("Source/Rakis/Shaders"));
		if (FPaths::DirectoryExists(ShaderDir) && !AllShaderSourceDirectoryMappings().Contains(TEXT("/Project/Rakis")))
		{
			AddShaderSourceDirectoryMapping(TEXT("/Project/Rakis"), ShaderDir);
		}
	}
};

IMPLEMENT_PRIMARY_GAME_MODULE(FRakisModule, Rakis, "Rakis");
