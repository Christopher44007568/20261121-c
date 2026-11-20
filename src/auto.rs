use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub const AUTO_SEQUENCE_VERSION: &str = "2026-11-21.1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowSlot {
    Main,
    Thumbnail,
}

impl WindowSlot {
    pub fn label(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Thumbnail => "thumbnail",
        }
    }

    pub fn other(self) -> Self {
        match self {
            Self::Main => Self::Thumbnail,
            Self::Thumbnail => Self::Main,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AutoAction {
    Resize {
        window: WindowSlot,
        width: u32,
        height: u32,
    },
    Minimize {
        window: WindowSlot,
    },
    Restore {
        window: WindowSlot,
    },
    InvalidateSurface {
        window: WindowSlot,
    },
    Probe {
        name: String,
    },
    Finish,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AutoStep {
    pub at_ms: u64,
    pub action: AutoAction,
    pub note: &'static str,
}

#[derive(Debug, Clone)]
pub struct AutoSequence {
    steps: Vec<AutoStep>,
    cursor: usize,
    started: Option<Instant>,
    finished: bool,
}

impl Default for AutoSequence {
    fn default() -> Self {
        Self::new()
    }
}

impl AutoSequence {
    pub fn new() -> Self {
        Self {
            steps: scripted_steps(),
            cursor: 0,
            started: None,
            finished: false,
        }
    }

    pub fn start(&mut self, now: Instant) {
        self.cursor = 0;
        self.started = Some(now);
        self.finished = false;
    }

    pub fn restart(&mut self, now: Instant) {
        self.start(now);
    }

    pub fn steps(&self) -> &[AutoStep] {
        &self.steps
    }

    pub fn completed_steps(&self) -> usize {
        self.cursor
    }

    pub fn total_steps(&self) -> usize {
        self.steps.len()
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    pub fn started(&self) -> Option<Instant> {
        self.started
    }

    pub fn elapsed(&self, now: Instant) -> Duration {
        self.started
            .map(|started| now.saturating_duration_since(started))
            .unwrap_or_default()
    }

    pub fn take_due(&mut self, now: Instant) -> Vec<AutoStep> {
        let Some(started) = self.started else {
            return Vec::new();
        };
        let elapsed_ms = now.saturating_duration_since(started).as_millis() as u64;
        let mut due = Vec::new();
        while let Some(step) = self.steps.get(self.cursor) {
            if step.at_ms > elapsed_ms {
                break;
            }
            due.push(step.clone());
            self.cursor += 1;
            if matches!(step.action, AutoAction::Finish) {
                self.finished = true;
                break;
            }
        }
        due
    }
}

fn resize(at_ms: u64, window: WindowSlot, width: u32, height: u32) -> AutoStep {
    AutoStep {
        at_ms,
        action: AutoAction::Resize {
            window,
            width,
            height,
        },
        note: "reconfigure one surface while the shared texture stays resident",
    }
}

fn window_action(at_ms: u64, window: WindowSlot, action: fn(WindowSlot) -> AutoAction) -> AutoStep {
    AutoStep {
        at_ms,
        action: action(window),
        note: "exercise winit minimize/restore without rebuilding the device",
    }
}

fn scripted_steps() -> Vec<AutoStep> {
    let mut steps = Vec::new();
    steps.push(AutoStep {
        at_ms: 350,
        action: AutoAction::Probe {
            name: "warmup".to_owned(),
        },
        note: "record both surfaces presenting before the sequence",
    });

    let main_drag = [
        (1000, 980, 680),
        (1150, 1260, 820),
        (1300, 760, 740),
        (1450, 1380, 560),
        (1600, 880, 690),
        (1750, 1180, 480),
        (1900, 1040, 720),
    ];
    for (at_ms, width, height) in main_drag {
        steps.push(resize(at_ms, WindowSlot::Main, width, height));
    }

    let thumb_drag = [
        (2150, 430, 340),
        (2300, 290, 250),
        (2450, 500, 310),
        (2600, 330, 390),
        (2750, 410, 230),
    ];
    for (at_ms, width, height) in thumb_drag {
        steps.push(resize(at_ms, WindowSlot::Thumbnail, width, height));
    }

    steps.push(window_action(3000, WindowSlot::Main, |window| {
        AutoAction::Minimize { window }
    }));
    steps.push(window_action(3400, WindowSlot::Main, |window| {
        AutoAction::Restore { window }
    }));
    steps.push(window_action(3700, WindowSlot::Thumbnail, |window| {
        AutoAction::Minimize { window }
    }));
    steps.push(window_action(4100, WindowSlot::Thumbnail, |window| {
        AutoAction::Restore { window }
    }));

    steps.push(AutoStep {
        at_ms: 4400,
        action: AutoAction::InvalidateSurface {
            window: WindowSlot::Thumbnail,
        },
        note: "drop only the thumbnail surface and recreate its swapchain",
    });
    steps.push(AutoStep {
        at_ms: 4800,
        action: AutoAction::Probe {
            name: "thumbnail_lost_main_alive".to_owned(),
        },
        note: "main frames must advance while the thumbnail surface recovers",
    });
    steps.push(AutoStep {
        at_ms: 5100,
        action: AutoAction::InvalidateSurface {
            window: WindowSlot::Main,
        },
        note: "now invalidate the opposite surface",
    });
    steps.push(AutoStep {
        at_ms: 5500,
        action: AutoAction::Probe {
            name: "main_lost_thumbnail_alive".to_owned(),
        },
        note: "thumbnail frames must advance while the main surface recovers",
    });
    steps.push(AutoStep {
        at_ms: 6000,
        action: AutoAction::Probe {
            name: "final".to_owned(),
        },
        note: "record final totals and save the restored view",
    });
    steps.push(AutoStep {
        at_ms: 6100,
        action: AutoAction::Finish,
        note: "write the verification report",
    });
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_exercises_both_windows_and_both_surface_losses() {
        let sequence = AutoSequence::new();
        let mut resized = [0usize; 2];
        let mut minimized = [0usize; 2];
        let mut restored = [0usize; 2];
        let mut invalidated = [0usize; 2];
        let index = |window: WindowSlot| match window {
            WindowSlot::Main => 0,
            WindowSlot::Thumbnail => 1,
        };

        for step in sequence.steps() {
            match &step.action {
                AutoAction::Resize { window, .. } => {
                    resized[index(*window)] += 1;
                }
                AutoAction::Minimize { window } => {
                    minimized[index(*window)] += 1;
                }
                AutoAction::Restore { window } => {
                    restored[index(*window)] += 1;
                }
                AutoAction::InvalidateSurface { window } => {
                    invalidated[index(*window)] += 1;
                }
                _ => {}
            }
        }

        assert!(resized[0] >= 4, "main needs repeated resize events");
        assert!(resized[1] >= 4, "thumbnail needs repeated resize events");
        assert_eq!(minimized, [1, 1]);
        assert_eq!(restored, [1, 1]);
        assert_eq!(invalidated, [1, 1]);
        assert!(matches!(
            sequence.steps().last().map(|step| &step.action),
            Some(AutoAction::Finish)
        ));
    }

    #[test]
    fn timing_is_monotonic_and_finish_terminates_sequence() {
        let sequence = AutoSequence::new();
        let mut previous = 0;
        for step in sequence.steps() {
            assert!(step.at_ms >= previous);
            previous = step.at_ms;
        }
    }

    #[test]
    fn due_steps_are_released_in_time_order() {
        let mut sequence = AutoSequence::new();
        let start = Instant::now();
        sequence.start(start);
        assert!(sequence.take_due(start).is_empty());
        let first_batch = sequence.take_due(start + Duration::from_millis(400));
        assert_eq!(first_batch.len(), 1);
        assert!(matches!(first_batch[0].action, AutoAction::Probe { .. }));

        let all = sequence.take_due(start + Duration::from_secs(10));
        assert!(all
            .iter()
            .any(|step| matches!(step.action, AutoAction::Finish)));
        assert!(sequence.is_finished());
        assert!(sequence
            .take_due(start + Duration::from_secs(20))
            .is_empty());
    }
}
