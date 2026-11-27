package org.arkaplan.ototiklayici.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import org.arkaplan.ototiklayici.service.PanelRequest

@Composable
fun AppRoot(
    vm: MainViewModel,
    onOpenPanel: (PanelRequest) -> Unit,
    onEnableService: () -> Unit,
    onAppInfo: () -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        vm.messages.collect { snackbar.showSnackbar(it) }
    }
    BackHandler(enabled = vm.backStack.size > 1) { vm.back() }

    val screen = vm.backStack.last()
    val depth = vm.backStack.size
    AnimatedContent(
        targetState = screen to depth,
        transitionSpec = {
            val forward = targetState.second >= initialState.second
            if (forward) {
                (slideInHorizontally { it / 5 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 10 } + fadeOut())
            } else {
                (slideInHorizontally { -it / 10 } + fadeIn()) togetherWith (slideOutHorizontally { it / 5 } + fadeOut())
            }
        },
        label = "ekran",
    ) { (target, _) ->
        when (target) {
            Screen.Home -> HomeScreen(vm, snackbar, onOpenPanel, onEnableService, onAppInfo)
            Screen.Settings -> SettingsScreen(vm, snackbar)
            Screen.Help -> HelpScreen(vm)
            is Screen.Editor -> MacroEditorScreen(vm, target.macroId, snackbar, onOpenPanel)
        }
    }
}
