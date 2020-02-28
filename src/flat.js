"use strict";
// @info
//   Polyfill for SVG getPathData() and setPathData() methods. Based on:
//   - SVGPathSeg polyfill by Philip Rogers (MIT License)
//     https://github.com/progers/pathseg
//   - SVGPathNormalizer by Tadahisa Motooka (MIT License)
//     https://github.com/motooka/SVGPathNormalizer/tree/master/src
//   - arcToCubicCurves() by Dmitry Baranovskiy (MIT License)
//     https://github.com/DmitryBaranovskiy/raphael/blob/v2.1.1/raphael.core.js#L1837
// @author
//   Jarosław Foksa
//   Jeremy Apthorp
// @license
//   MIT License
const commandsMap = {
    "Z": "Z", "M": "M", "L": "L", "C": "C", "Q": "Q", "A": "A", "H": "H", "V": "V", "S": "S", "T": "T",
    "z": "Z", "m": "m", "l": "l", "c": "c", "q": "q", "a": "a", "h": "h", "v": "v", "s": "s", "t": "t"
};
const Source = function (string) {
    this._string = string;
    this._currentIndex = 0;
    this._endIndex = this._string.length;
    this._prevCommand = null;
    this._skipOptionalSpaces();
};
Source.prototype = {
    parseSegment: function () {
        var char = this._string[this._currentIndex];
        var command = commandsMap[char] ? commandsMap[char] : null;
        if (command === null) {
            // Possibly an implicit command. Not allowed if this is the first command.
            if (this._prevCommand === null) {
                return null;
            }
            // Check for remaining coordinates in the current command.
            if ((char === "+" || char === "-" || char === "." || (char >= "0" && char <= "9")) && this._prevCommand !== "Z") {
                if (this._prevCommand === "M") {
                    command = "L";
                }
                else if (this._prevCommand === "m") {
                    command = "l";
                }
                else {
                    command = this._prevCommand;
                }
            }
            else {
                command = null;
            }
            if (command === null) {
                return null;
            }
        }
        else {
            this._currentIndex += 1;
        }
        this._prevCommand = command;
        var values = null;
        var cmd = command.toUpperCase();
        if (cmd === "H" || cmd === "V") {
            values = [this._parseNumber()];
        }
        else if (cmd === "M" || cmd === "L" || cmd === "T") {
            values = [this._parseNumber(), this._parseNumber()];
        }
        else if (cmd === "S" || cmd === "Q") {
            values = [this._parseNumber(), this._parseNumber(), this._parseNumber(), this._parseNumber()];
        }
        else if (cmd === "C") {
            values = [
                this._parseNumber(),
                this._parseNumber(),
                this._parseNumber(),
                this._parseNumber(),
                this._parseNumber(),
                this._parseNumber()
            ];
        }
        else if (cmd === "A") {
            values = [
                this._parseNumber(),
                this._parseNumber(),
                this._parseNumber(),
                this._parseArcFlag(),
                this._parseArcFlag(),
                this._parseNumber(),
                this._parseNumber()
            ];
        }
        else if (cmd === "Z") {
            this._skipOptionalSpaces();
            values = [];
        }
        if (values === null || values.indexOf(null) >= 0) {
            // Unknown command or known command with invalid values
            return null;
        }
        else {
            return { type: command, values: values };
        }
    },
    hasMoreData: function () {
        return this._currentIndex < this._endIndex;
    },
    peekSegmentType: function () {
        var char = this._string[this._currentIndex];
        return commandsMap[char] ? commandsMap[char] : null;
    },
    initialCommandIsMoveTo: function () {
        // If the path is empty it is still valid, so return true.
        if (!this.hasMoreData()) {
            return true;
        }
        var command = this.peekSegmentType();
        // Path must start with moveTo.
        return command === "M" || command === "m";
    },
    _isCurrentSpace: function () {
        var char = this._string[this._currentIndex];
        return char <= " " && (char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f");
    },
    _skipOptionalSpaces: function () {
        while (this._currentIndex < this._endIndex && this._isCurrentSpace()) {
            this._currentIndex += 1;
        }
        return this._currentIndex < this._endIndex;
    },
    _skipOptionalSpacesOrDelimiter: function () {
        if (this._currentIndex < this._endIndex &&
            !this._isCurrentSpace() &&
            this._string[this._currentIndex] !== ",") {
            return false;
        }
        if (this._skipOptionalSpaces()) {
            if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === ",") {
                this._currentIndex += 1;
                this._skipOptionalSpaces();
            }
        }
        return this._currentIndex < this._endIndex;
    },
    // Parse a number from an SVG path. This very closely follows genericParseNumber(...) from
    // Source/core/svg/SVGParserUtilities.cpp.
    // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-PathDataBNF
    _parseNumber: function () {
        var exponent = 0;
        var integer = 0;
        var frac = 1;
        var decimal = 0;
        var sign = 1;
        var expsign = 1;
        var startIndex = this._currentIndex;
        this._skipOptionalSpaces();
        // Read the sign.
        if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === "+") {
            this._currentIndex += 1;
        }
        else if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === "-") {
            this._currentIndex += 1;
            sign = -1;
        }
        if (this._currentIndex === this._endIndex ||
            ((this._string[this._currentIndex] < "0" || this._string[this._currentIndex] > "9") &&
                this._string[this._currentIndex] !== ".")) {
            // The first character of a number must be one of [0-9+-.].
            return null;
        }
        // Read the integer part, build right-to-left.
        var startIntPartIndex = this._currentIndex;
        while (this._currentIndex < this._endIndex &&
            this._string[this._currentIndex] >= "0" &&
            this._string[this._currentIndex] <= "9") {
            this._currentIndex += 1; // Advance to first non-digit.
        }
        if (this._currentIndex !== startIntPartIndex) {
            var scanIntPartIndex = this._currentIndex - 1;
            var multiplier = 1;
            while (scanIntPartIndex >= startIntPartIndex) {
                integer += multiplier * (this._string[scanIntPartIndex] - "0");
                scanIntPartIndex -= 1;
                multiplier *= 10;
            }
        }
        // Read the decimals.
        if (this._currentIndex < this._endIndex && this._string[this._currentIndex] === ".") {
            this._currentIndex += 1;
            // There must be a least one digit following the .
            if (this._currentIndex >= this._endIndex ||
                this._string[this._currentIndex] < "0" ||
                this._string[this._currentIndex] > "9") {
                return null;
            }
            while (this._currentIndex < this._endIndex &&
                this._string[this._currentIndex] >= "0" &&
                this._string[this._currentIndex] <= "9") {
                frac *= 10;
                decimal += (this._string.charAt(this._currentIndex) - "0") / frac;
                this._currentIndex += 1;
            }
        }
        // Read the exponent part.
        if (this._currentIndex !== startIndex &&
            this._currentIndex + 1 < this._endIndex &&
            (this._string[this._currentIndex] === "e" || this._string[this._currentIndex] === "E") &&
            (this._string[this._currentIndex + 1] !== "x" && this._string[this._currentIndex + 1] !== "m")) {
            this._currentIndex += 1;
            // Read the sign of the exponent.
            if (this._string[this._currentIndex] === "+") {
                this._currentIndex += 1;
            }
            else if (this._string[this._currentIndex] === "-") {
                this._currentIndex += 1;
                expsign = -1;
            }
            // There must be an exponent.
            if (this._currentIndex >= this._endIndex ||
                this._string[this._currentIndex] < "0" ||
                this._string[this._currentIndex] > "9") {
                return null;
            }
            while (this._currentIndex < this._endIndex &&
                this._string[this._currentIndex] >= "0" &&
                this._string[this._currentIndex] <= "9") {
                exponent *= 10;
                exponent += (this._string[this._currentIndex] - "0");
                this._currentIndex += 1;
            }
        }
        var number = integer + decimal;
        number *= sign;
        if (exponent) {
            number *= Math.pow(10, expsign * exponent);
        }
        if (startIndex === this._currentIndex) {
            return null;
        }
        this._skipOptionalSpacesOrDelimiter();
        return number;
    },
    _parseArcFlag: function () {
        if (this._currentIndex >= this._endIndex) {
            return null;
        }
        var flag = null;
        var flagChar = this._string[this._currentIndex];
        this._currentIndex += 1;
        if (flagChar === "0") {
            flag = 0;
        }
        else if (flagChar === "1") {
            flag = 1;
        }
        else {
            return null;
        }
        this._skipOptionalSpacesOrDelimiter();
        return flag;
    }
};
const parsePathDataString = function (string) {
    if (!string || string.length === 0)
        return [];
    var source = new Source(string);
    var pathData = [];
    if (source.initialCommandIsMoveTo()) {
        while (source.hasMoreData()) {
            var pathSeg = source.parseSegment();
            if (pathSeg === null) {
                break;
            }
            else {
                pathData.push(pathSeg);
            }
        }
    }
    return pathData;
};
const $cachedPathData = typeof Symbol !== 'undefined' ? Symbol() : "__cachedPathData";
const $cachedNormalizedPathData = typeof Symbol !== 'undefined' ? Symbol() : "__cachedNormalizedPathData";
// @info
//   Get an array of corresponding cubic bezier curve parameters for given arc curve paramters.
var arcToCubicCurves = function (x1, y1, x2, y2, r1, r2, angle, largeArcFlag, sweepFlag, _recursive) {
    var degToRad = function (degrees) {
        return (Math.PI * degrees) / 180;
    };
    var rotate = function (x, y, angleRad) {
        var X = x * Math.cos(angleRad) - y * Math.sin(angleRad);
        var Y = x * Math.sin(angleRad) + y * Math.cos(angleRad);
        return { x: X, y: Y };
    };
    var angleRad = degToRad(angle);
    var params = [];
    var f1, f2, cx, cy;
    if (_recursive) {
        f1 = _recursive[0];
        f2 = _recursive[1];
        cx = _recursive[2];
        cy = _recursive[3];
    }
    else {
        var p1 = rotate(x1, y1, -angleRad);
        x1 = p1.x;
        y1 = p1.y;
        var p2 = rotate(x2, y2, -angleRad);
        x2 = p2.x;
        y2 = p2.y;
        var x = (x1 - x2) / 2;
        var y = (y1 - y2) / 2;
        var h = (x * x) / (r1 * r1) + (y * y) / (r2 * r2);
        if (h > 1) {
            h = Math.sqrt(h);
            r1 = h * r1;
            r2 = h * r2;
        }
        var sign;
        if (largeArcFlag === sweepFlag) {
            sign = -1;
        }
        else {
            sign = 1;
        }
        var r1Pow = r1 * r1;
        var r2Pow = r2 * r2;
        var left = r1Pow * r2Pow - r1Pow * y * y - r2Pow * x * x;
        var right = r1Pow * y * y + r2Pow * x * x;
        var k = sign * Math.sqrt(Math.abs(left / right));
        cx = k * r1 * y / r2 + (x1 + x2) / 2;
        cy = k * -r2 * x / r1 + (y1 + y2) / 2;
        f1 = Math.asin(parseFloat(((y1 - cy) / r2).toFixed(9)));
        f2 = Math.asin(parseFloat(((y2 - cy) / r2).toFixed(9)));
        if (x1 < cx) {
            f1 = Math.PI - f1;
        }
        if (x2 < cx) {
            f2 = Math.PI - f2;
        }
        if (f1 < 0) {
            f1 = Math.PI * 2 + f1;
        }
        if (f2 < 0) {
            f2 = Math.PI * 2 + f2;
        }
        if (sweepFlag && f1 > f2) {
            f1 = f1 - Math.PI * 2;
        }
        if (!sweepFlag && f2 > f1) {
            f2 = f2 - Math.PI * 2;
        }
    }
    var df = f2 - f1;
    if (Math.abs(df) > (Math.PI * 120 / 180)) {
        var f2old = f2;
        var x2old = x2;
        var y2old = y2;
        if (sweepFlag && f2 > f1) {
            f2 = f1 + (Math.PI * 120 / 180) * (1);
        }
        else {
            f2 = f1 + (Math.PI * 120 / 180) * (-1);
        }
        x2 = cx + r1 * Math.cos(f2);
        y2 = cy + r2 * Math.sin(f2);
        params = arcToCubicCurves(x2, y2, x2old, y2old, r1, r2, angle, 0, sweepFlag, [f2, f2old, cx, cy]);
    }
    df = f2 - f1;
    var c1 = Math.cos(f1);
    var s1 = Math.sin(f1);
    var c2 = Math.cos(f2);
    var s2 = Math.sin(f2);
    var t = Math.tan(df / 4);
    var hx = 4 / 3 * r1 * t;
    var hy = 4 / 3 * r2 * t;
    var m1 = [x1, y1];
    var m2 = [x1 + hx * s1, y1 - hy * c1];
    var m3 = [x2 + hx * s2, y2 - hy * c2];
    var m4 = [x2, y2];
    m2[0] = 2 * m1[0] - m2[0];
    m2[1] = 2 * m1[1] - m2[1];
    if (_recursive) {
        return [m2, m3, m4].concat(params);
    }
    else {
        params = [m2, m3, m4].concat(params);
        var curves = [];
        for (var i = 0; i < params.length; i += 3) {
            var r1 = rotate(params[i][0], params[i][1], angleRad);
            var r2 = rotate(params[i + 1][0], params[i + 1][1], angleRad);
            var r3 = rotate(params[i + 2][0], params[i + 2][1], angleRad);
            curves.push([r1.x, r1.y, r2.x, r2.y, r3.x, r3.y]);
        }
        return curves;
    }
};
var clonePathData = function (pathData) {
    return pathData.map(function (seg) {
        return { type: seg.type, values: Array.prototype.slice.call(seg.values) };
    });
};
// @info
//   Takes any path data, returns path data that consists only from absolute commands.
var absolutizePathData = function (pathData) {
    var absolutizedPathData = [];
    var currentX = null;
    var currentY = null;
    var subpathX = null;
    var subpathY = null;
    pathData.forEach(function (seg) {
        var type = seg.type;
        if (type === "M") {
            var x = seg.values[0];
            var y = seg.values[1];
            absolutizedPathData.push({ type: "M", values: [x, y] });
            subpathX = x;
            subpathY = y;
            currentX = x;
            currentY = y;
        }
        else if (type === "m") {
            var x = currentX + seg.values[0];
            var y = currentY + seg.values[1];
            absolutizedPathData.push({ type: "M", values: [x, y] });
            subpathX = x;
            subpathY = y;
            currentX = x;
            currentY = y;
        }
        else if (type === "L") {
            var x = seg.values[0];
            var y = seg.values[1];
            absolutizedPathData.push({ type: "L", values: [x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "l") {
            var x = currentX + seg.values[0];
            var y = currentY + seg.values[1];
            absolutizedPathData.push({ type: "L", values: [x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "C") {
            var x1 = seg.values[0];
            var y1 = seg.values[1];
            var x2 = seg.values[2];
            var y2 = seg.values[3];
            var x = seg.values[4];
            var y = seg.values[5];
            absolutizedPathData.push({ type: "C", values: [x1, y1, x2, y2, x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "c") {
            var x1 = currentX + seg.values[0];
            var y1 = currentY + seg.values[1];
            var x2 = currentX + seg.values[2];
            var y2 = currentY + seg.values[3];
            var x = currentX + seg.values[4];
            var y = currentY + seg.values[5];
            absolutizedPathData.push({ type: "C", values: [x1, y1, x2, y2, x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "Q") {
            var x1 = seg.values[0];
            var y1 = seg.values[1];
            var x = seg.values[2];
            var y = seg.values[3];
            absolutizedPathData.push({ type: "Q", values: [x1, y1, x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "q") {
            var x1 = currentX + seg.values[0];
            var y1 = currentY + seg.values[1];
            var x = currentX + seg.values[2];
            var y = currentY + seg.values[3];
            absolutizedPathData.push({ type: "Q", values: [x1, y1, x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "A") {
            var x = seg.values[5];
            var y = seg.values[6];
            absolutizedPathData.push({
                type: "A",
                values: [seg.values[0], seg.values[1], seg.values[2], seg.values[3], seg.values[4], x, y]
            });
            currentX = x;
            currentY = y;
        }
        else if (type === "a") {
            var x = currentX + seg.values[5];
            var y = currentY + seg.values[6];
            absolutizedPathData.push({
                type: "A",
                values: [seg.values[0], seg.values[1], seg.values[2], seg.values[3], seg.values[4], x, y]
            });
            currentX = x;
            currentY = y;
        }
        else if (type === "H") {
            var x = seg.values[0];
            absolutizedPathData.push({ type: "H", values: [x] });
            currentX = x;
        }
        else if (type === "h") {
            var x = currentX + seg.values[0];
            absolutizedPathData.push({ type: "H", values: [x] });
            currentX = x;
        }
        else if (type === "V") {
            var y = seg.values[0];
            absolutizedPathData.push({ type: "V", values: [y] });
            currentY = y;
        }
        else if (type === "v") {
            var y = currentY + seg.values[0];
            absolutizedPathData.push({ type: "V", values: [y] });
            currentY = y;
        }
        else if (type === "S") {
            var x2 = seg.values[0];
            var y2 = seg.values[1];
            var x = seg.values[2];
            var y = seg.values[3];
            absolutizedPathData.push({ type: "S", values: [x2, y2, x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "s") {
            var x2 = currentX + seg.values[0];
            var y2 = currentY + seg.values[1];
            var x = currentX + seg.values[2];
            var y = currentY + seg.values[3];
            absolutizedPathData.push({ type: "S", values: [x2, y2, x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "T") {
            var x = seg.values[0];
            var y = seg.values[1];
            absolutizedPathData.push({ type: "T", values: [x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "t") {
            var x = currentX + seg.values[0];
            var y = currentY + seg.values[1];
            absolutizedPathData.push({ type: "T", values: [x, y] });
            currentX = x;
            currentY = y;
        }
        else if (type === "Z" || type === "z") {
            absolutizedPathData.push({ type: "Z", values: [] });
            currentX = subpathX;
            currentY = subpathY;
        }
    });
    return absolutizedPathData;
};
// @info
//   Takes path data that consists only from absolute commands, returns path data that consists only from
//   "M", "L", "C" and "Z" commands.
var reducePathData = function (pathData) {
    var reducedPathData = [];
    var lastType = null;
    var lastControlX = null;
    var lastControlY = null;
    var currentX = null;
    var currentY = null;
    var subpathX = null;
    var subpathY = null;
    pathData.forEach(function (seg) {
        if (seg.type === "M") {
            var x = seg.values[0];
            var y = seg.values[1];
            reducedPathData.push({ type: "M", values: [x, y] });
            subpathX = x;
            subpathY = y;
            currentX = x;
            currentY = y;
        }
        else if (seg.type === "C") {
            var x1 = seg.values[0];
            var y1 = seg.values[1];
            var x2 = seg.values[2];
            var y2 = seg.values[3];
            var x = seg.values[4];
            var y = seg.values[5];
            reducedPathData.push({ type: "C", values: [x1, y1, x2, y2, x, y] });
            lastControlX = x2;
            lastControlY = y2;
            currentX = x;
            currentY = y;
        }
        else if (seg.type === "L") {
            var x = seg.values[0];
            var y = seg.values[1];
            reducedPathData.push({ type: "L", values: [x, y] });
            currentX = x;
            currentY = y;
        }
        else if (seg.type === "H") {
            var x = seg.values[0];
            reducedPathData.push({ type: "L", values: [x, currentY] });
            currentX = x;
        }
        else if (seg.type === "V") {
            var y = seg.values[0];
            reducedPathData.push({ type: "L", values: [currentX, y] });
            currentY = y;
        }
        else if (seg.type === "S") {
            var x2 = seg.values[0];
            var y2 = seg.values[1];
            var x = seg.values[2];
            var y = seg.values[3];
            var cx1, cy1;
            if (lastType === "C" || lastType === "S") {
                cx1 = currentX + (currentX - lastControlX);
                cy1 = currentY + (currentY - lastControlY);
            }
            else {
                cx1 = currentX;
                cy1 = currentY;
            }
            reducedPathData.push({ type: "C", values: [cx1, cy1, x2, y2, x, y] });
            lastControlX = x2;
            lastControlY = y2;
            currentX = x;
            currentY = y;
        }
        else if (seg.type === "T") {
            var x = seg.values[0];
            var y = seg.values[1];
            var x1, y1;
            if (lastType === "Q" || lastType === "T") {
                x1 = currentX + (currentX - lastControlX);
                y1 = currentY + (currentY - lastControlY);
            }
            else {
                x1 = currentX;
                y1 = currentY;
            }
            var cx1 = currentX + 2 * (x1 - currentX) / 3;
            var cy1 = currentY + 2 * (y1 - currentY) / 3;
            var cx2 = x + 2 * (x1 - x) / 3;
            var cy2 = y + 2 * (y1 - y) / 3;
            reducedPathData.push({ type: "C", values: [cx1, cy1, cx2, cy2, x, y] });
            lastControlX = x1;
            lastControlY = y1;
            currentX = x;
            currentY = y;
        }
        else if (seg.type === "Q") {
            var x1 = seg.values[0];
            var y1 = seg.values[1];
            var x = seg.values[2];
            var y = seg.values[3];
            var cx1 = currentX + 2 * (x1 - currentX) / 3;
            var cy1 = currentY + 2 * (y1 - currentY) / 3;
            var cx2 = x + 2 * (x1 - x) / 3;
            var cy2 = y + 2 * (y1 - y) / 3;
            reducedPathData.push({ type: "C", values: [cx1, cy1, cx2, cy2, x, y] });
            lastControlX = x1;
            lastControlY = y1;
            currentX = x;
            currentY = y;
        }
        else if (seg.type === "A") {
            var r1 = Math.abs(seg.values[0]);
            var r2 = Math.abs(seg.values[1]);
            var angle = seg.values[2];
            var largeArcFlag = seg.values[3];
            var sweepFlag = seg.values[4];
            var x = seg.values[5];
            var y = seg.values[6];
            if (r1 === 0 || r2 === 0) {
                reducedPathData.push({ type: "C", values: [currentX, currentY, x, y, x, y] });
                currentX = x;
                currentY = y;
            }
            else {
                if (currentX !== x || currentY !== y) {
                    var curves = arcToCubicCurves(currentX, currentY, x, y, r1, r2, angle, largeArcFlag, sweepFlag);
                    curves.forEach(function (curve) {
                        reducedPathData.push({ type: "C", values: curve });
                    });
                    currentX = x;
                    currentY = y;
                }
            }
        }
        else if (seg.type === "Z") {
            reducedPathData.push(seg);
            currentX = subpathX;
            currentY = subpathY;
        }
        lastType = seg.type;
    });
    return reducedPathData;
};
const getLength = (el, key) => {console.error(key, el);
    if (key in el && "baseVal" in el[key]) {
        return el[key].baseVal.value;
    }
    else {
        // svgdom doesn't support rect.x.baseVal, see https://github.com/svgdotjs/svgdom/issues/32
        return +el.getAttribute(key);
    }
};
const path = function (options) {
    if (options && options.normalize) {
        if (this[$cachedNormalizedPathData]) {
            return clonePathData(this[$cachedNormalizedPathData]);
        }
        else {
            var pathData;
            if (this[$cachedPathData]) {
                pathData = clonePathData(this[$cachedPathData]);
            }
            else {
                pathData = parsePathDataString(this.getAttribute("d") || "");
                this[$cachedPathData] = clonePathData(pathData);
            }
            var normalizedPathData = reducePathData(absolutizePathData(pathData));
            this[$cachedNormalizedPathData] = clonePathData(normalizedPathData);
            return normalizedPathData;
        }
    }
    else {
        if (this[$cachedPathData]) {
            return clonePathData(this[$cachedPathData]);
        }
        else {
            var pathData = parsePathDataString(this.getAttribute("d") || "");
            this[$cachedPathData] = clonePathData(pathData);
            return pathData;
        }
    }
};
const rect = function (options) {
    var x = getLength(this, "x");
    var y = getLength(this, "y");
    var width = getLength(this, "width");
    var height = getLength(this, "height");
    var rx = this.hasAttribute("rx") ? getLength(this, "rx") : getLength(this, "ry");
    var ry = this.hasAttribute("ry") ? getLength(this, "ry") : getLength(this, "rx");
    if (rx > width / 2) {
        rx = width / 2;
    }
    if (ry > height / 2) {
        ry = height / 2;
    }
    var pathData = [
        { type: "M", values: [x + rx, y] },
        { type: "H", values: [x + width - rx] },
        { type: "A", values: [rx, ry, 0, 0, 1, x + width, y + ry] },
        { type: "V", values: [y + height - ry] },
        { type: "A", values: [rx, ry, 0, 0, 1, x + width - rx, y + height] },
        { type: "H", values: [x + rx] },
        { type: "A", values: [rx, ry, 0, 0, 1, x, y + height - ry] },
        { type: "V", values: [y + ry] },
        { type: "A", values: [rx, ry, 0, 0, 1, x + rx, y] },
        { type: "Z", values: [] }
    ];
    // Get rid of redundant "A" segs when either rx or ry is 0
    pathData = pathData.filter(function (s) {
        return s.type === "A" && (s.values[0] === 0 || s.values[1] === 0) ? false : true;
    });
    if (options && options.normalize === true) {
        pathData = reducePathData(pathData);
    }
    return pathData;
};
const circle = function (options) {
    var cx = getLength(this, "cx");
    var cy = getLength(this, "cy");
    var r = getLength(this, "r");
    var pathData = [
        { type: "M", values: [cx + r, cy] },
        { type: "A", values: [r, r, 0, 0, 1, cx, cy + r] },
        { type: "A", values: [r, r, 0, 0, 1, cx - r, cy] },
        { type: "A", values: [r, r, 0, 0, 1, cx, cy - r] },
        { type: "A", values: [r, r, 0, 0, 1, cx + r, cy] },
        { type: "Z", values: [] }
    ];
    if (options && options.normalize === true) {
        pathData = reducePathData(pathData);
    }
    return pathData;
};
const ellipse = function (options) {
    var cx = getLength(this, "cx");
    var cy = getLength(this, "cy");
    var rx = getLength(this, "rx");
    var ry = getLength(this, "ry");
    var pathData = [
        { type: "M", values: [cx + rx, cy] },
        { type: "A", values: [rx, ry, 0, 0, 1, cx, cy + ry] },
        { type: "A", values: [rx, ry, 0, 0, 1, cx - rx, cy] },
        { type: "A", values: [rx, ry, 0, 0, 1, cx, cy - ry] },
        { type: "A", values: [rx, ry, 0, 0, 1, cx + rx, cy] },
        { type: "Z", values: [] }
    ];
    if (options && options.normalize === true) {
        pathData = reducePathData(pathData);
    }
    return pathData;
};
const line = function () {
    const x1 = getLength(this, "x1");
    const x2 = getLength(this, "x2");
    const y1 = getLength(this, "y1");
    const y2 = getLength(this, "y2");
    return [
        { type: "M", values: [x1, y1] },
        { type: "L", values: [x2, y2] }
    ];
};
const polyline = function () {
    var pathData = [];
    for (var i = 0; i < this.points.numberOfItems; i += 1) {
        var point = this.points.getItem(i);
        pathData.push({
            type: (i === 0 ? "M" : "L"),
            values: [point.x, point.y]
        });
    }
    return pathData;
};
const polygon = function () {
    var pathData = [];
    for (var i = 0; i < this.points.numberOfItems; i += 1) {
        var point = this.points.getItem(i);
        pathData.push({
            type: (i === 0 ? "M" : "L"),
            values: [point.x, point.y]
        });
    }
    pathData.push({
        type: "Z",
        values: []
    });
    return pathData;
};
const pathDataGetters = {
    circle,
    ellipse,
    path,
    polygon,
    polyline,
    line,
    rect,
};
function getPathData(svgElement, options) {
    const type = svgElement.nodeName.toLowerCase();
    if (type in pathDataGetters) {
        return pathDataGetters[type].call(svgElement, options);
    }
    else {
        throw new Error(`Unsupported SVG element type: '${type}'`);
    }
}


function isFlatEnough([x0, y0, x1, y1, x2, y2, x3, y3], flatness) {
    // https://github.com/paperjs/paper.js/blob/a61e83edf2ed1870bd41bad135f4f6fc85b0f628/src/path/Curve.js#L806
    const ux = 3 * x1 - 2 * x0 - x3, uy = 3 * y1 - 2 * y0 - y3, vx = 3 * x2 - 2 * x3 - x0, vy = 3 * y2 - 2 * y3 - y0;
    return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy)
        <= 16 * flatness * flatness;
}
function subdivide([x0, y0, x1, y1, x2, y2, x3, y3], t) {
    // https://github.com/paperjs/paper.js/blob/a61e83edf2ed1870bd41bad135f4f6fc85b0f628/src/path/Curve.js#L606
    if (t === undefined)
        t = 0.5;
    // Triangle computation, with loops unrolled.
    let u = 1 - t,
    // Interpolate from 4 to 3 points
    x4 = u * x0 + t * x1, y4 = u * y0 + t * y1, x5 = u * x1 + t * x2, y5 = u * y1 + t * y2, x6 = u * x2 + t * x3, y6 = u * y2 + t * y3,
    // Interpolate from 3 to 2 points
    x7 = u * x4 + t * x5, y7 = u * y4 + t * y5, x8 = u * x5 + t * x6, y8 = u * y5 + t * y6,
    // Interpolate from 2 points to 1 point
    x9 = u * x7 + t * x8, y9 = u * y7 + t * y8;
    // We now have all the values we need to build the sub-curves:
    return [
        [x0, y0, x4, y4, x7, y7, x9, y9],
        [x9, y9, x8, y8, x6, y6, x3, y3] // right
    ];
}
function flatten(v, flatness, maxRecursion = 32) {
    const minSpan = 1 / maxRecursion;
    const parts = [];
    function computeParts(curve, t1, t2) {
        if ((t2 - t1) > minSpan && !isFlatEnough(curve, flatness) /* && !isStraight(curve) */) {
            const halves = subdivide(curve, 0.5);
            const tMid = (t1 + t2) / 2;
            computeParts(halves[0], t1, tMid);
            computeParts(halves[1], tMid, t2);
        }
        else {
            const dx = curve[6] - curve[0];
            const dy = curve[7] - curve[1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
                parts.push(curve);
            }
        }
    }
    computeParts(v, 0, 1);
    return parts;
}
function* walkSvgShapes(svgEl) {
    switch (svgEl.nodeName.toLowerCase()) {
        case 'svg':
        case 'g':
            for (const child of svgEl.children) {
              var shapename = svgEl.nodeName.toLowerCase();
                yield* walkSvgShapes(child);
            }
            break;
      /*  case 'rect':
        case 'circle':
        case 'ellipse':
        case 'polygon':*/
        case 'path':
        case 'line':
        case 'polyline':

            yield svgEl;
            break;
    }
}
function flattenSVG(svg, options = {}) {
    const { maxError = 0.1 } = options;
    const svgPoint = svg.createSVGPoint();
    const paths = [];
    for (const path of walkSvgShapes(svg)) {
        const type = path.nodeName.toLowerCase();
        const ctm = path.getCTM();
        var inverse = ctm.inverse();
        const xf = ([x, y]) => {
            svgPoint.x = x;
            svgPoint.y = y;
            const xfd = svgPoint.matrixTransform(inverse);
            var newx =   ctm.a * xfd.x + ctm.c * xfd.y + ctm.e;
            var newy = ctm.b * xfd.x + ctm.d * xfd.y + ctm.f;
            return [newx, newy];
        };
        const pathData = getPathData(path, { normalize: true });
        let cur = null;
        let closePoint = null;
        for (const cmd of pathData) {
            if (cmd.type === 'M') {
                cur = xf(cmd.values);
                closePoint = cur;
                paths.push({
                    points: [cur],
                    stroke: path.getAttribute('stroke'),
                    style: path.getAttribute('style'),
                    id: path.getAttribute('id'),
                    fill: path.getAttribute('fill'),
                    strokewidth: path.getAttribute('stroke-width'),
                    strokelinecap: path.getAttribute('stroke-linecap'),
                    strokelinejoin: path.getAttribute('stroke-linejoin'),
                    transform: path.getAttribute('transform'),
                    xfilter: path.getAttribute('filter'),
                    strokedasharray: path.getAttribute('stroke-dasharray')

                    // getComputedStyle doesn't seem to work until the JS loop that inserted it is done...
                    // stroke: path.getComputedStyle(path).stroke
                });
            }
            else if (cmd.type === 'L') {
                cur = xf(cmd.values);
                paths[paths.length - 1].points.push(cur);
            }
            else if (cmd.type === 'C') {
                const [x1, y1, x2, y2, x3, y3] = cmd.values;
                const [x0, y0] = cur;
                const [tx1, ty1] = xf([x1, y1]);
                const [tx2, ty2] = xf([x2, y2]);
                const [tx3, ty3] = xf([x3, y3]);
                const parts = flatten([x0, y0, tx1, ty1, tx2, ty2, tx3, ty3], maxError);
                for (const part of parts) {
                    paths[paths.length - 1].points.push([part[6], part[7]]);
                }
                cur = [tx3, ty3];
            }
            else if (cmd.type === 'A') {
                const [rx_, ry_, xAxisRotation, largeArc, sweep, x, y] = cmd.values;
                const phi = xAxisRotation;
                const fS = sweep;
                const fA = largeArc;
                const { cos, sin, atan2, sqrt, sign, acos, abs, ceil } = Math;
                // https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes
                const mpx = (cur[0] - x) / 2, mpy = (cur[1] - y) / 2;
                const x1_ = cos(phi) * mpx + sin(phi) * mpy, y1_ = -sin(phi) * mpx + cos(phi) * mpy;
                const x1_2 = x1_ * x1_, y1_2 = y1_ * y1_;
                // ... ensure radii are large enough
                const L = x1_2 / (rx_ * rx_) + y1_2 / (ry_ * ry_);
                const rx = L <= 1 ? sqrt(L) * rx_ : rx_;
                const ry = L <= 1 ? sqrt(L) * ry_ : ry_;
                const rx2 = rx * rx, ry2 = ry * ry;
                let factor = (rx2 * ry2 - rx2 * y1_2 - ry2 * x1_2) / (rx2 * y1_2 + ry2 * x1_2);
                if (abs(factor) < 0.0001)
                    factor = 0;
                if (factor < 0)
                    throw new Error(`bad arc args ${factor}`);
                const k = (fA === fS ? -1 : 1) * sqrt(factor);
                const cx_ = k * rx * y1_ / ry, cy_ = k * -ry * x1_ / rx;
                const cx = cos(phi) * cx_ - sin(phi) * cy_ + (cur[0] + x) / 2, cy = sin(phi) * cx_ + cos(phi) * cy_ + (cur[1] + y) / 2;
                const ang = (ux, uy, vx, vy) => {
                    /*
                    (ux*vy - uy*vx < 0 ? -1 : 1) *
                      acos((ux*vx+uy*vy) / sqrt(ux*ux+uy*uy)*sqrt(vx*vx+vy*vy))
                      */
                    // https://github.com/paperjs/paper.js/blob/f5366fb3cb53bc1ea52e9792e2ec2584c0c4f9c1/src/path/Path.js#L2516
                    return atan2(ux * vy - uy * vx, ux * vx + uy * vy);
                };
                const t1 = ang(1, 0, (x1_ - cx_) / rx, (y1_ - cy_) / ry);
                const dt_ = ang((x1_ - cx_) / rx, (y1_ - cy_) / ry, (-x1_ - cx_) / rx, (-y1_ - cy_) / ry) % (Math.PI * 2);
                const dt = fS === 0 && dt_ > 0 ? dt_ - Math.PI * 2 :
                    fS === 1 && dt_ < 0 ? dt_ + Math.PI * 2 :
                        dt_;
                // now:
                // - (cx, cy) is the center of the ellipse
                // - (rx, ry) is the radius
                // - phi is the angle around the x-axis of the current
                //   coordinate system to the x-axis of the ellipse
                // - t1 is the start angle of the elliptical arc prior to the stretch and rotate operations.
                // - t1+dt is the end angle of the elliptical arc prior to the stretch and rotate operations.
                // parameterization:
                // ( x )  =  ( cos phi   -sin phi ) . ( rx cos t )  +  ( cx )
                // ( y )  =  ( sin phi    cos phi )   ( ry sin t )     ( cy )
                // https://i.imgur.com/JORhNjU.jpg
                // maximum error based on maximum deviation from true arc
                const e0 = maxError;
                const n = ceil(abs(dt) / acos(1 - e0 / rx));
                for (let i = 1; i <= n; i++) {
                    const theta = t1 + dt * i / n;
                    const tx = cos(phi) * rx * cos(theta) - sin(phi) * ry * sin(theta) + cx;
                    const ty = sin(phi) * rx * cos(theta) + cos(phi) * ry * sin(theta) + cy;
                    paths[paths.length - 1].points.push([tx, ty]);
                }
                cur = [x, y];
            }
            else if (cmd.type === 'Z') {
                if (closePoint && (cur[0] !== closePoint[0] || cur[1] !== closePoint[1])) {
                    paths[paths.length - 1].points.push(closePoint);
                }
            }
            else {
                throw Error(`Unexpected path command: "${cmd}"`);
            }
        }
    }
    return paths;
}
