import CoreGraphics
import Foundation

private func rawCursorMotionDuration(distance: Double, speed: Double, acceleration: Double) -> Double {
    let accelerationDistance = speed * speed / acceleration
    if distance <= accelerationDistance {
        return 2 * sqrt(distance / acceleration)
    }
    return 2 * speed / acceleration + (distance - accelerationDistance) / speed
}

func cursorMotionDuration(distance: Double, speed: Double, acceleration: Double) -> Double {
    min(2, max(0.048, rawCursorMotionDuration(distance: distance, speed: speed, acceleration: acceleration)))
}

func cursorMotionFraction(
    progress: Double,
    distance: Double,
    speed: Double,
    acceleration: Double
) -> Double {
    guard distance > 0 else { return 1 }
    let rawDuration = rawCursorMotionDuration(distance: distance, speed: speed, acceleration: acceleration)
    let elapsed = min(1, max(0, progress)) * rawDuration
    let accelerationTime = min(speed / acceleration, rawDuration / 2)
    let peakSpeed = acceleration * accelerationTime
    let cruiseTime = max(0, rawDuration - 2 * accelerationTime)
    let accelerationDistance = 0.5 * acceleration * accelerationTime * accelerationTime
    let traveled: Double
    if elapsed <= accelerationTime {
        traveled = 0.5 * acceleration * elapsed * elapsed
    } else if elapsed <= accelerationTime + cruiseTime {
        traveled = accelerationDistance + peakSpeed * (elapsed - accelerationTime)
    } else {
        let remaining = rawDuration - elapsed
        traveled = distance - 0.5 * acceleration * remaining * remaining
    }
    return min(1, max(0, traveled / distance))
}

func cursorMotionPoint(from origin: CGPoint, to target: CGPoint, fraction: Double) -> CGPoint {
    let distance = hypot(target.x - origin.x, target.y - origin.y)
    guard distance > 0 else { return target }
    let delta = CGPoint(x: target.x - origin.x, y: target.y - origin.y)
    let directionSign: CGFloat = Int(abs(origin.x + origin.y + target.x + target.y)) % 2 == 0 ? 1 : -1
    let bend = min(18, distance * 0.06) * directionSign
    let normal = CGPoint(x: -delta.y / distance, y: delta.x / distance)
    let control1 = CGPoint(
        x: origin.x + delta.x * 0.32 + normal.x * bend,
        y: origin.y + delta.y * 0.32 + normal.y * bend
    )
    let control2 = CGPoint(
        x: origin.x + delta.x * 0.72 + normal.x * bend * 0.45,
        y: origin.y + delta.y * 0.72 + normal.y * bend * 0.45
    )
    let inverse = 1 - fraction
    return CGPoint(
        x: inverse * inverse * inverse * origin.x
            + 3 * inverse * inverse * fraction * control1.x
            + 3 * inverse * fraction * fraction * control2.x
            + fraction * fraction * fraction * target.x,
        y: inverse * inverse * inverse * origin.y
            + 3 * inverse * inverse * fraction * control1.y
            + 3 * inverse * fraction * fraction * control2.y
            + fraction * fraction * fraction * target.y
    )
}
